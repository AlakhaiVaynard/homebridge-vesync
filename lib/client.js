const axios = require('axios');
const moment = require('moment');

module.exports = class EtekCityClient {

    constructor(log) {
        this.client = axios.create({
            baseURL: 'https://smartapi.vesync.com',
        });
        this.log = log
        this.lastLogin = moment('2000-01-01')
    }

    newRequest(data) {
        return Object.assign({
            "acceptLanguage": "en",
            "appVersion": "2.9.8",
            "phoneBrand": "Android SDK",
            "phoneOS": "Android 10",
            "timeZone": "America/New_York",
            "traceId": new Date().getTime(),
            "accountID": this.accountID,
            "token": this.token,
        }, data)
    }

    login(username, password) {
        // If token has been set in last 24 hours, don't log in again
        if (this.lastLogin.isAfter(moment().subtract(24, 'hours'))) {
            return Promise.resolve();
        }

        var md5 = require('md5');

        return this.client.post('/cloud/v1/user/login', this.newRequest({
            "method": "login",
            "email": username,
            "password": md5(password),
        }))
            .then(({ data }) => {
                this.token = data.result.token;
                this.accountID = data.result.accountID;
                this.lastLogin = moment();
            })
            .catch((error) => {
                this.log("Error", error);
            });
    }

    getDevices() {
        return this.client.post('/cloud/v2/deviceManaged/devices', this.newRequest({
            "pageNum": 1,
            "pageSize": 100,
            "method": "devices",
        })).then(({ data }) => {
            let devices = data.result.list.
                filter(device => device.type === "wifi-switch").
                map((device) => {
                    return {
                        id: device.uuid,
                        name: device.deviceName,
                        status: device.deviceStatus,
                        type: device.deviceType
                    };
                });

            return devices;
        });
    }

    turnOn(device) {
        this.setState(device, 'on')
    }

    turnOff(device) {
        this.setState(device, 'off')
    }

    setState(device, state) {
        let url = `/v1/${device.type}/${device.id}/status/${state}`

        switch (device.type) {
            case 'ESW03-USA':
                url = "/10a/v1/device/devicestatus";
                break;
        }

        const body = this.newRequest({
            "status": state,
            "uuid": device.id
        })

        const headers = {
            tk: this.token,
            accountID: this.accountID,
            tz: 'America/New_York',
            'Accept-Language': 'en',
        }

        return this.client.put(url, body, { headers }).then(({ data }) => {
            return data;
        })
    }
};
