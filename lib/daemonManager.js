const http = require("http");
const events = require("events");
const async = require("async");

/**
 * The daemon interface interacts with the coin daemon by using the rpc interface.
 * in order to make it work it needs, as constructor, an array of objects containing
 * - 'host'    : hostname where the coin lives
 * - 'port'    : port where the coin accepts rpc connections
 * - 'user'    : username of the coin for the rpc interface
 * - 'password': password for the rpc interface of the coin
**/
module.exports = class DaemonManager extends events.EventEmitter {
    constructor(daemons, logger) {
        super();
        this.logger = logger || function (severity, message) {
            console.log("[" + severity + "]: " + message);
        };

        this.instances = (() =>  {
            for (let i = 0; i < daemons.length; i++)
                daemons[i]["index"] = String(i);
            return daemons;
        })();
    }

    init() {
        this.isOnline((online) => {
            if (online)
                this.emit("online");
        });
    }

    isOnline(callback) {
        this.cmd("getpeerinfo", [], (results) => {
            const allOnline = results.every((result) => {
                return !result.error;
            });
            callback(allOnline);
            if (!allOnline)
                this.emit("connectionFailed", results);
        }, false, false);
    }

    performHttpRequest(instance, reqRawData, callback) {
        const options = {
            hostname: (typeof (instance.host) == "undefined" ? "127.0.0.1" : instance.host),
            port: instance.port,
            method: "POST",
            auth: instance.user + ":" + instance.password,
            headers: {
                "Content-Length": reqRawData.length
            }
        };

        const parseJson = (res, resRawData) => {
            let dataJson;

            if (res.statusCode === 401) {
                this.logger("error", "Unauthorized RPC access - invalid RPC username or password");
                return;
            }

            try {
                dataJson = JSON.parse(resRawData);
            } catch (e) {
                if (resRawData.indexOf(":-nan") !== -1) {
                    resRawData = resRawData.replace(/:-nan,/g, ":0");
                    parseJson(res, resRawData);
                    return;
                }
                this.logger("error", "Could not parse rpc data from daemon instance  " + instance.index
                    + "\nRequest Data: " + reqRawData
                    + "\nReponse Data: " + resRawData);

            }
            if (dataJson)
                callback(dataJson.error, dataJson, resRawData);
        };

        const req = http.request(options, (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => { parseJson(res, data); });
        });

        req.on("error", (e) => {
            if (e.name === "ECONNREFUSED")
                callback({type: "offline", message: e.message}, null);
            else
                callback({type: "request error", message: e.message}, null);
        });

        req.end(reqRawData);
    }

    batchCmd(cmdArray, callback) {

        const requestJson = [];

        for (let i = 0; i < cmdArray.length; i++){
            requestJson.push({
                method: cmdArray[i][0],
                params: cmdArray[i][1],
                id: Date.now() + Math.floor(Math.random() * 10) + i
            });
        }

        const serializedRequest = JSON.stringify(requestJson);

        this.performHttpRequest(this.instances[0], serializedRequest, (error, result) => {
            callback(error, result);
        });
    }

    cmd(method, params, callback, withStreamResults, withReturnRawData) {
        const results = [];
        async.each(this.instances,
            (instance, eachCallback) => {
                let itemFinished = (error, result, data) => {
                    let returnObj = {
                        error: error,
                        response: (result || {}).result,
                        instance: instance
                    };
                    if (withReturnRawData) returnObj.data = data;
                    if (withStreamResults) callback(returnObj);
                    else results.push(returnObj);
                    eachCallback();
                };
    
                let reqRawData = JSON.stringify({
                    method: method,
                    params: params,
                    id: Date.now() + Math.floor(Math.random() * 10)
                });
    
                this.performHttpRequest(instance, reqRawData, (error, result, data) => {
                    itemFinished(error, result, data);
                });
            },()=>{
                if (!withStreamResults){
                    callback(results);
                }
            }
        );
    }
};

