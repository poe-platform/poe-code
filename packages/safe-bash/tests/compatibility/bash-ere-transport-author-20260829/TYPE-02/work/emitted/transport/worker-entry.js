import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { operation, EreTransportError } from "./protocol.js";
import { record } from "./validation.js";
import { executeWireRequest } from "./wire-engine.js";
import { integer } from "./accounting.js";
if (isMainThread || !parentPort)
    throw new EreTransportError("PROTOCOL", "ERE entry requires its owned Worker");
const data = record(workerData, ["operation", "version"], () => { });
if (data.operation !== operation || data.version !== 1)
    throw new EreTransportError("PROTOCOL", "invalid ERE Worker data");
const port = parentPort;
let busy = false;
let lastId = 0;
port.on("message", (message) => {
    if (busy)
        throw new EreTransportError("PROTOCOL", "concurrent ERE Worker request");
    const frame = record(message, ["version", "operation", "id", "grantId", "profile", "bounds", "allowance", "pattern", "subject"], () => { });
    integer(frame.id);
    if (frame.id <= lastId)
        throw new EreTransportError("PROTOCOL", "replayed ERE request");
    lastId = frame.id;
    busy = true;
    void executeWireRequest(message).then(reply => {
        port.postMessage(reply);
        busy = false;
    }).catch(error => { queueMicrotask(() => { throw error; }); });
});
port.postMessage({ version: 1, operation, kind: "ready" });
