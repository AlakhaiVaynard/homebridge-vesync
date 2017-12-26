"use strict";

let EtekcityClient = require('./lib/client');

let client = new EtekcityClient();

//var vesync = require('./lib/vesync.js');
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-vesync", "VesyncPlug", VeseyncPlugPlatform);
}

function VeseyncPlugPlatform(log, config, api) {
    this.log = log;
    this.config = config;
    //    this.plugs = this.config.plugs || [];
    this.accessories = [];
    this.cache_timeout = 10; // seconds
    this.debug = config['debug'] || false;
    this.username = config['username'];
    this.password = config['password'];

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

VeseyncPlugPlatform.prototype.configureAccessory = function(accessory) {
    var accessoryId = accessory.context.id;
    this.log("configureAccessory");
    this.setService(accessory);
    this.accessories[accessoryId] = accessory;
}

VeseyncPlugPlatform.prototype.didFinishLaunching = function() {
    var that = this;

    this.deviceDiscovery();
    setInterval(that.devicePolling.bind(that), this.cache_timeout * 1000);
    setInterval(that.deviceDiscovery.bind(that), this.cache_timeout * 6000);
}

VeseyncPlugPlatform.prototype.devicePolling = function() {
    /*var me = this;

    // Send a return status message every interval
    for (var id in this.accessories) {
        var plug = this.accessories[id];
        if (me.debug)
            me.log("Poll:", id, plug.context.name);
        me.getPowerState(plug, function(err, status) {
          me.log("Got status: " + status);
        })
    }*/
}

VeseyncPlugPlatform.prototype.deviceDiscovery = function() {
    var me = this;

    // Send a device discovery message every interval
    if (me.debug)
        me.log("Sending device discovery message");

    client.login(this.username, this.password).then( () => {
        return client.getDevices();
    }).then( devices => {
          if (this.debug) this.log("Adding discovered devices");

          for (var i in devices) {
              var existing = this.accessories[devices[i].id];
              if (!existing) {
                  me.log("Adding:", devices[i].id, devices[i].name);
                  this.addAccessory(devices[i]);
              } else {
                  if (this.debug) me.log("Skipping existing device", i);
              }
          }
          if (devices) {
              for (var id in this.accessories) {
                  var found = devices.find( (device) => { return device.id.includes(id); });
                  if (!found) {
                      me.log("Not found ", id);
                      removeAccessory(this.accessories[id]);
                  }
              }
          }
      if (this.debug) me.log("Discovery complete");
    });
}

VeseyncPlugPlatform.prototype.addAccessory = function(data) {
    if (!this.accessories[data.id]) {
        var uuid = UUIDGen.generate(data.id);

        var newAccessory = new Accessory(data.id, uuid, 8);

        newAccessory.context.name = data.name;
        newAccessory.context.id = data.id;
        newAccessory.context.cb = null;

        newAccessory.addService(Service.Outlet, data.name);

        this.setService(newAccessory);

        this.api.registerPlatformAccessories("homebridge-vesync", "VesyncPlug", [newAccessory]);
    } else {
        var newAccessory = this.accessories[data.id];
    }

    this.getInitState(newAccessory, data);

    this.accessories[data.id] = newAccessory;
}

VeseyncPlugPlatform.prototype.removeAccessory = function(accessory) {
    if (accessory) {
        var name = accessory.context.name;
        var id = accessory.context.id;
        this.log.warn("Removing VesyncPlug: " + name + ". No longer reachable or configured.");
        this.api.unregisterPlatformAccessories("homebridge-vesync", "VesyncPlug", [accessory]);
        delete this.accessories[id];
    }
}

VeseyncPlugPlatform.prototype.setService = function(accessory) {
    accessory.getService(Service.Outlet)
        .getCharacteristic(Characteristic.On)
        .on('set', this.setPowerState.bind(this, accessory.context))
        .on('get', this.getPowerState.bind(this, accessory.context));

    accessory.on('identify', this.identify.bind(this, accessory.context));
}

VeseyncPlugPlatform.prototype.getInitState = function(accessory, data) {
    var info = accessory.getService(Service.AccessoryInformation);

    accessory.context.manufacturer = "Etekcity";
    info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer);

    accessory.context.model = "ESW01-USA";
    info.setCharacteristic(Characteristic.Model, accessory.context.model);

    info.setCharacteristic(Characteristic.SerialNumber, accessory.context.id);

    accessory.getService(Service.Outlet)
        .getCharacteristic(Characteristic.On)
        .getValue();
}

VeseyncPlugPlatform.prototype.setPowerState = function(thisPlug, powerState, callback) {
    var that = this;

    if (this.debug)
        this.log("Sending device status change");

    return client.login(this.username, this.password).then( () => {
        return client.getDevices();
    }).then( devices => {
      return devices.find( (device) => { return device.name.includes(thisPlug.name); });
    }).then( (device) => {
        thisPlug.status = device.status;
        if (this.debug) this.log("Discovery complete");
        if(device.status == 'open' && powerState == false) {
          return client.turnOff(device.id);
        }
        if(device.status == 'break' && powerState == true) {
          return client.turnOn(device.id);
        }
    }).then( () => {
      callback();
    }).catch( (err) => {
      this.log("Failed to set power state to", powerState);
      callback(err);
    })
}


VeseyncPlugPlatform.prototype.getPowerState = function(thisPlug, callback) {
    if (this.accessories[thisPlug.id]) {
        this.log("Getting Status: %s %s", thisPlug.id, thisPlug.name)
        if (this.debug) this.log("Sending device status message");

        return client.login(this.username, this.password).then( () => {
            return client.getDevices();
        }).then( devices => {
          return devices.find( (device) => { return device.name.includes(thisPlug.name); });
        }).then( (device) => {
            thisPlug.status = device.status;
            if (this.debug) this.log("Discovery complete");
            callback(null, device.status == 'open');
        });
    } else {
        callback(new Error("Device not found"));
    }

}

VeseyncPlugPlatform.prototype.identify = function(thisPlug, paired, callback) {
    this.log("Identify requested for " + thisPlug.name);
    callback();
}
