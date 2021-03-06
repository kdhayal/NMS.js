
var ssh2 = require('ssh2');
var telnet = require('../lib/util-telnet');
var ping = require("net-ping");
var dns = require('dns');


var EventEmitter = require('events').EventEmitter;
var util = require('util');

var shell = function () {
	var self = this;
	// Default options
	self.PING_options = {
		networkProtocol: ping.NetworkProtocol.IPv4,
		packetSize: 16,
		retries: 1,
		sessionId: (process.pid % 65535),
		timeout: 2000,
		ttl: 128
	};
	self.kill = false;
	self.dead = false;
	self.PING_session = ping.createSession(self.PING_options);
}
util.inherits(shell, EventEmitter);
shell.prototype.PING = function (ipAddress, feedCb, doneCb) {
    this._connected = false;
    var self = this

    if (ipAddress.split(".").length == 4 && parseInt(ipAddress.split(".")[3]) ){
        ping(ipAddress)
    } else {
        self.kill ? self.kill : feedCb('resolving dns: ' + ipAddress);
    	dns.lookup(ipAddress, function (err, address, family) {
            if (err) {
                var response = { data: '' };
                response = ipAddress + ": " + err.toString();
                self.kill ? self.kill : doneCb(response);
            } else {
            	
            	ping(address)
            }
        });
    }


 function ping(ipAddress) {
     feedCb('pinging: ' + ipAddress);
        self.PING_session.pingHost(ipAddress, function (error, target, sent, rcvd) {
            var ms = rcvd - sent;
            var response = { data: '' };
            if (error) {
                response = target + ": " + error.toString();
            }
            else {
                response = target + ": Alive (ms=" + ms + ")";
            }

            self.kill ? self.kill : doneCb(response);

        })
    }

}
shell.prototype.TRACERT = function (ipAddress, feedCb, doneCb) {
    this._connected = false;
    var self = this

    if (ipAddress.split(".").length == 4 && parseInt(ipAddress.split(".")[3])) {
        tracert(ipAddress)
    } else {
        self.kill ? self.kill : feedCb('resolving dns: ' + ipAddress);
    	dns.lookup(ipAddress,4, function (err, address, family) {
            if (err) {
                var response = { data: '' };
                response = ipAddress + ": " + err.toString();
                self.kill ? self.kill : doneCb(response);
            } else {
            	
            	tracert(address)
            }
        });
    }

    function _doneCb(error, target) {
        var response = { data: '' }
        if (error) {
            response = (target + ": " + error.toString());
        }
        else {
            response = (target + ": Done");
        }
        self.kill ? self.kill : doneCb(response);
    } 
    function _feedCb(error, target, ttl, sent, rcvd) {
        var response = { data: '' }
        var ms = rcvd - sent;
        if (error) {
            if (error instanceof ping.TimeExceededError) {
                response= (target + ": " + error.source + " (ttl="
					+ ttl + " ms=" + ms + ")");
            } else {
                response= (target + ": " + error.toString()
					+ " (ttl=" + ttl + " ms=" + ms + ")");
            }

        } else {
            response = (target + ": " + target + " (ttl=" + ttl
				+ " ms=" + ms + ")");
        }
        if (!self.kill) {
            self.kill ? self.kill : feedCb(response);
        } else {
            if (!self.dead) {
                self.dead = true;
                self.kill ? self.kill : doneCb(response);
            }
        }
    }
    function tracert(ipAddress) {
        self.kill ? self.kill : feedCb('tracing route to: ' + ipAddress);
        self.PING_session.traceRoute(ipAddress, 30, _feedCb, _doneCb);
    }
}
shell.prototype.connect = function (opts) {
    this._protocol = opts.protocol || 'telnet'; //ssh
    this._host = opts.host || 'localhost';
    this._port = opts.port || (this._protocol == 'telnet') ? 23 : 22;
    this._log = opts.log || false;
    this._username = opts.username;
    this._password = opts.password;
    this._enpassword = opts.enpassword;
    this._shellname = opts.shellname;
    this._promt = false;
    this._en = false;
    this._autoauth = opts.autoauth || 'false';
    this._authenticated = (this._autoauth) ? true : false; //logic hack
    this._connected = false;
    this._sock = (this._protocol == 'telnet') ? new telnet() : new ssh2();

    this._stream = {};

    var _self = this;

    this._sock.connect(opts);

    this._sock.on('connect', function () {
        _self.emit('connect');
    });
    this._sock.on('keyboard-interactive', function (name, instructions, instructionsLang, prompts, finish) {
        console.log(name, instructions, instructionsLang, prompts, finish);
    });
    this._sock.on('banner', function (message, language) {
        _self.processBuffer(message.replace(/\n/g, "\r\n"));
    });
    this._sock.on('ready', function () {
        _self._connected = true;
        _self._sock.shell(function (err, stream) {
            if (err) { console.log(err); }
            _self._stream = stream;
            // _self._stream.setWindow(64, 200, 600, 800);
            _self._stream.on('data', function (data, extended) {
                _self.processBuffer(data);
            });
            _self._stream.on('end', function () {
                _self.emit('end');
                _self._connected = false;
            });
            _self._stream.on('close', function (had_error) {
                //_self.emit('close', had_error);
                _self._connected = false;
            });
            _self._stream.on('error', function (Error) {
                _self.emit('error', Error);
                _self._connected = false;
            });
            _self._stream.on('exit', function (code, signal) {
                _self._sock.end();
                _self._connected = false;
            });
        });
    });
    this._sock.on('data', function (data) {
        _self._connected = true;
        _self.processBuffer(data);
    });
    this._sock.on('timeout', function () {
        _self.emit('timeout');
    });
    this._sock.on('error', function (Error) {
        _self._connected = false;
        _self.emit('error', Error, _self._shellname);
    });
    this._sock.on('end', function () {
        _self._connected = false;
        _self.emit('end', _self._shellname);

    });
    this._sock.on('close', function (had_error) {
        _self._connected = false;
        _self.emit('close', had_error, _self._shellname);

    });
}
shell.prototype.processBuffer = function (data) {
    var _self = this;
    if (!_self._authenticated && _self._password.length > 0) {
        _self.login(data);
    }
    if (_self._log) { console.log("rx:", data.toString()); }
    _self.emit('data', data, _self._shellname);
}
shell.prototype.login = function (data) {
	var _self = this;
	data = data.toString();
    if ((data.indexOf("Username:") > -1 || data.indexOf("login:") == data.length - 7) && !_self._promt) {
        _self._promt = true;
        _self.write(_self._username + "\r");
    }
    else if ((data.indexOf("Password:") > -1)) {
    	if (_self._en) {
        		_self.write(_self._enpassword + "\r");
    	} else {
    		_self.write(_self._password + "\r");
        }
    }
    else if ((data.indexOf(">") > -1) && !_self._en && _self._enpassword.length > 0) {
        _self._en = true;
        _self.write("en\r");
    }
    else if ((data.indexOf("#") > -1)) {
        _self._authenticated = true;
    }
}
shell.prototype.write = function (data) {
    var _self = this;
    if (_self._log) { console.log("tx:", data.toString()); }
    (_self._protocol == 'telnet') ? _self._sock.write(data) : _self._stream.write(data);

}
shell.prototype.end = function () {
	var self = this;
	if (this._connected) {
		this._sock.end();
	} else {
		self.kill = true;
	}
    this.emit('end', this._shellname);
}
module.exports = exports = shell;
exports.shell = shell;
exports.native = undefined;