
// Copyright 2013 Stephen Vickers

var snmp = require ("net-snmp");
var util = require ("util");

if (process.argv.length < 5) {
	console.log ("usage: cisco-device-inventory <target> <community> <version>");
	process.exit (1);
}

var target = process.argv[2];
var community = process.argv[3];
var version = (process.argv[4] == "2c") ? snmp.Version2c : snmp.Version1;

function pollDeviceDetails (session, device, pollCb) {
	//console.log ("getting system properties...");
	console.log("getting system properties...", session, device, pollCb);
	var oids = ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.6.0"];

	session.get (oids, function (error, varbinds) {
		if (error) {
			pollCb (error, null);
		} else {
			for (var i = 0; i < varbinds.length; i++) {
				if (snmp.isVarbindError (varbinds[i])) {
					console.error (snmp.varbindError (varbinds[i]));
					return;
				}
			}

			device.name = varbinds[0].value.toString ();
			device.description = varbinds[1].value.toString ();
			device.location = varbinds[2].value.toString ();

			pollDeviceInterfaces (session, device, pollCb);
		}
	});
}

function pollDeviceDevices (session, device, pollCb) {
	function pollVlans () {
		if (device.vlandIds.length > 0) {
			var vlanId = device.vlandIds.pop ();
			
            
            var session = snmp.createSession (target, community + "@" + vlanId, {version: version});
			//var session = snmp.createSession(target, community, { version: version });
			console.log ("getting macs for vlan " + vlanId + "...");

			// dot1dTpFdbTable: dot1dTpFdbPort , dot1dTpFdbStatus
			/*
            dot1dTpFdbStatus OBJECT-TYPE
              SYNTAX  INTEGER {
                          other(1),
                          invalid(2),
                          learned(3),
                          self(4),
                          mgmt(5)
                      }
			*/
			var oid = "1.3.6.1.2.1.17.4.3";
			session.tableColumns(oid, [2, 3], function (error, table) {
			    if (error) {
			        console.log("error");
			        //pollCb(error, null);
			    } else {
			        for (index in table) {
			            var mac = new Buffer(index.split(".")).toString("hex");
			            var row = table[index];
			            delete table[index];
			            table[mac] = row;
			        }

			        device.devices[vlanId] = table;
			        if (device.vlandIds.length > 0) {
			            pollVlans();
			        } else {
			            delete device.vlandIds;
			            pollCb(null, device);
			        }
			    }
			});
		}
	}

	console.log ("getting macs...");

	if (device.vlandIds.length > 0) {
		pollVlans ();
	} else {
		delete device.vlandIds;
		pollCb (null, device);
	}
}

function pollPortTable(session, device, pollCb) {
    console.log("getting 	dot1dBasePortTable...");

    // dot1dBasePortTable: dot1dBasePort,dot1dBasePortIfIndex
    session.tableColumns("1.3.6.1.2.1.17.1.4", [1, 2], function (error, table) {
        if (error) {
            pollCb(error, null);
        } else {
            device.PortTable = table;

        }
    });
}



function pollDeviceInterfaces (session, device, pollCb) {
	console.log ("getting interfaces...");

	// ifTable: ifDescr, ifType, ifPhysAddress
	session.tableColumns("1.3.6.1.2.1.2.2", [1, 2, 3, 6], function (error, table) {
	    if (error) {
	        pollCb(error, null);
	    } else {
	        device.intefaces = table;
	       // console.log(table);
	        pollDeviceVlans(session, device, pollCb);
	    }
	});
}

function pollDeviceVlans (session, device, pollCb) {
	console.log ("getting vlans...");
	// vlanPortIslOperStatus: 1.3.6.1.4.1.9.5.1.9.3.1.8 () part of the cisco-stack-mib
	// vtpVlanTable: vtpVlanType
	session.tableColumns("1.3.6.1.4.1.9.9.46.1.3.1", [3], function (error, table) {
	    if (error) {
	        pollCb(error, null);
	    } else {
	        //console.log(table);
	        device.vlans = table;
	        device.vlandIds = [];
	        device.devices = {};

	        for (index in table) {
	            var match = index.match(/(\d+)$/);
	            if (match) {
	                var vlanId = match[1];
	                var row = table[index];
	                delete table[index];
	                table[vlanId] = row;
	                if (table[vlanId][3] == 1)
	                    device.vlandIds.push(vlanId);
	            }
	        }

	        pollDeviceDevices(session, device, pollCb);
	        pollPortTable(session, device, pollCb);


	    }
	});
}

function pollDevice (session, device, pollCb) {
	pollDeviceDetails (session, device, pollCb);
}

var session = snmp.createSession (target, community, {version: version});

pollDevice(session, {}, function (error, device) {
    if (error) {
        console.error(error.toString());
    } else {
        //console.warn (util.inspect (device, {depth: 3}));
        for (index in device.PortTable) {
            //console.log(index + "\r\n" + util.inspect(device.PortTable[index], { depth: 3 }) + "\r\n");
        }
        for (vlanId in device.devices) {

            for (MAC in device.devices[vlanId]) {
                if (device.PortTable[device.devices[vlanId][MAC]['2']] != null) {//LEARNED
                    var IfIndex = device.PortTable[device.devices[vlanId][MAC]['2']]['2']
                    var ifDescr = device.intefaces[IfIndex]['2'].toString()
                    //console.log(MAC + "\t" + vlanId + "\t" + device.devices[vlanId][MAC]['2'] + "\t" + (device.PortTable[device.devices[vlanId][MAC]['2']]['2']));
                    //var mac = new Buffer(ifDescr.split(" ")).toString("hex");
                    console.log(device.description + "\t" + vlanId + "\t" + ifDescr + "\t" + MAC);

                }
                else {
                    console.log(device.description + "\t" + vlanId + "\t" + device.devices[vlanId][MAC]['2'] + "\t" + MAC);
                }
            }
            //console.log(vlanId + "\r\n" + util.inspect(device.devices[vlanId], { depth: 3 }) + "\r\n");
        }
    }
});
