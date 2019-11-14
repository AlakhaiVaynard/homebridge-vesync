"use strict";

let EtekcityClient = require('./lib/client');
let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-vesync", "VesyncPlug", VeseyncPlugPlatform);
};

function VeseyncPlugPlatform(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = {};
    this.cache_timeout = 10; // seconds
    this.debug = config['debug'] || false;
    this.username = config['username'];
    this.password = config['password'];

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }

    this.client = new EtekcityClient(log);
}

VeseyncPlugPlatform.prototype.configureAccessory = function(accessory) {
    let accessoryId = accessory.context.id;
    if (this.debug) this.log("configureAccessory: " + accessoryId);

    // Handle rename case. Depending on which order the accessories come back in, we will want to handle them differently below
    if (this.accessories[accessoryId]) {
        this.log("Duplicate accessory detected, removing existing if possible, otherwise removing this accessory", accessoryId);
        try {
            this.removeAccessory(this.accessories[accessoryId], accessoryId);
            this.setService(accessory);
        } catch (error) {
            this.removeAccessory(accessory, accessoryId);
            accessory = this.accessories[accessoryId];
        }
    } else {
        this.setService(accessory);
    }

    this.accessories[accessoryId] = accessory;
};

VeseyncPlugPlatform.prototype.didFinishLaunching = function() {
    let that = this;

    this.deviceDiscovery();
    setInterval(that.deviceDiscovery.bind(that), this.cache_timeout * 6000);
};

VeseyncPlugPlatform.prototype.deviceDiscovery = function() {
    let me = this;
    if (me.debug) me.log("DeviceDiscovery invoked");

    this.client.login(this.username, this.password).then( () => {
        return this.client.getDevices();
    }).then( devices => {
        if (me.debug) me.log("Adding discovered devices");
        for (let i in devices) {
            let existing = me.accessories[devices[i].id];

            if (!existing) {
                me.log("Adding device: ", devices[i].id, devices[i].name);
                me.addAccessory(devices[i]);
            } else {
                if (me.debug) me.log("Skipping existing device", i);
            }
        }

        // Check existing accessories exist in vesync devices
        if (devices) {
            for (let index in me.accessories) {
                var acc = me.accessories[index];
                var found = devices.find( (device) => { return device.id.includes(index); });
                if (!found) {
                    me.log("Previously configured accessory not found, removing", index);
                    me.removeAccessory(me.accessories[index]);
                } else if (found.name != acc.context.name) {
                    me.log("Accessory name does not match device name, got " + found.name + " expected " + acc.context.name);
                    me.removeAccessory(me.accessories[index]);
                    me.addAccessory(found);
                    me.log("Accessory removed & readded!");
                }
            }
        }

        if (me.debug) me.log("Discovery complete");
    });
};

VeseyncPlugPlatform.prototype.addAccessory = function(data) {
    if (!this.accessories[data.id]) {
        let uuid = UUIDGen.generate(data.id);
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
};

/**
 * In some cases the accessory context is undefined, or the accessory is undefined. to keep the code dry, this
 * is the only method for removing an accessory from the homebridge platform and the plugin accessory context.
 * 
 * When the id is already known, it should be passed as the second parameter to ensure both homebridge api and
 * local accessory context is cleaned up after a device rename/removal. There may be a case where the id needs
 * to be removed from local context, but is missing from the homebridge api, so I wrapped the
 * unregisterPlatformAccessories call in a try/catch to avoid crashing before removing from this.accessories 
 * 
 * If the accessoryId is not passed in, attempt to find the accessory id from the context. In the case where
 * the id is still not determined, attempt to remove the device from the homebridge api to avoid crashes. 
 */
VeseyncPlugPlatform.prototype.removeAccessory = function(accessory, accessoryId = undefined) {
    if (accessory) {
        let id = accessoryId !== undefined ? accessoryId : (accessory.context === undefined ? undefined : accessory.context.id);
        if (this.debug) this.log("Removing accessory", id);

        try {
            this.api.unregisterPlatformAccessories("homebridge-vesync", "VesyncPlug", [accessory]);
        } catch (error) {
            // in case its already been deregistered, don't crash. remove from plugin's accessories context below
        }

        // Remove from local accessories context if id is defined
        if (id !== undefined) {
            delete this.accessories[id];
        }
    }
};

VeseyncPlugPlatform.prototype.setService = function(accessory) {
    accessory.getService(Service.Outlet)
        .getCharacteristic(Characteristic.On)
        .on('set', this.setPowerState.bind(this, accessory.context))
        .on('get', this.getPowerState.bind(this, accessory.context));

    accessory.on('identify', this.identify.bind(this, accessory.context));
};

VeseyncPlugPlatform.prototype.getInitState = function(accessory, data) {
    let info = accessory.getService(Service.AccessoryInformation);

    accessory.context.manufacturer = "Etekcity";
    info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer);

    accessory.context.model = "ESW01-USA";
    info.setCharacteristic(Characteristic.Model, accessory.context.model);

    info.setCharacteristic(Characteristic.SerialNumber, accessory.context.id);

    accessory.getService(Service.Outlet)
        .getCharacteristic(Characteristic.On)
        .getValue();
};

VeseyncPlugPlatform.prototype.setPowerState = function(thisPlug, powerState, callback) {
    let that = this;
    if (this.debug) this.log("Sending device status change");

    return this.client.login(this.username, this.password).then( () => {
        return this.client.getDevices();
    }).then( devices => {
        return devices.find( (device) => { return device.name.includes(thisPlug.name); });
    }).then( (device) => {
        thisPlug.status = device.status;
        if (device.status == 'on' && powerState == false) {
            return this.client.turnOff(device);
        }

        if (device.status == 'off' && powerState == true) {
            return this.client.turnOn(device);
        }
    }).then( () => {
        callback();
    }).catch( (err) => {
        this.log("Failed to set power state to", powerState);
        callback(err);
    });
};

VeseyncPlugPlatform.prototype.getPowerState = function(thisPlug, callback) {
    if (this.accessories[thisPlug.id]) {
        this.log("Getting Status: %s %s", thisPlug.id, thisPlug.name)

        return this.client.login(this.username, this.password).then( () => {
            return this.client.getDevices();
        }).then( devices => {
            return devices.find( (device) => { return device.name.includes(thisPlug.name); });
        }).then( (device) => {
            if (typeof device === 'undefined') {
                if (this.debug) this.log("Removing undefined device", thisPlug.name);
                this.removeAccessory(thisPlug)
            } else {
                thisPlug.status = device.status;
                if (this.debug) this.log("getPowerState complete");
                callback(null, device.status == 'on');
            }
        });
    } else {
        callback(new Error("Device not found"));
    }
};

VeseyncPlugPlatform.prototype.identify = function(thisPlug, paired, callback) {
    this.log("Identify requested for " + thisPlug.name);
    callback();
}
