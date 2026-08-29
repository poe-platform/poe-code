import { parentPort } from "node:worker_threads";
import { compile } from "./matching.js";
import { matchExpr } from "../expr/bre-worker.js";
import { ExprMatchError, validateExprRequest } from "./protocol.js";
if (!parentPort)
    throw new Error("regex worker requires a parent port");
const port = parentPort;
let previous = "";
let matcher;
port.on("message", (request) => {
    if (request?.descriptor?.kind === "expr-match") {
        let reply;
        try {
            validateExprRequest(request);
            reply = { id: request.id, operation: "expr-match", result: matchExpr(request.descriptor, request.rows[0].bytes) };
        }
        catch (error) {
            if (!(error instanceof ExprMatchError))
                throw error;
            reply = { id: request.id, operation: "expr-match", category: error.category, error: error.message };
        }
        port.postMessage(reply);
        return;
    }
    const legacy = request;
    let reply;
    try {
        const identity = JSON.stringify(request.descriptor);
        if (identity !== previous || !matcher) {
            matcher = undefined;
            matcher = compile(legacy.descriptor);
            previous = identity;
        }
        const results = request.rows.map((row, index) => {
            const matches = matcher(row, index);
            const ranges = new Float64Array(matches.length * 2);
            for (let index = 0; index < matches.length; index++) {
                ranges[index * 2] = matches[index].start;
                ranges[index * 2 + 1] = matches[index].end;
            }
            return ranges;
        });
        reply = { id: request.id, results };
        port.postMessage(reply, results.map(result => result.buffer));
    }
    catch (error) {
        reply = { id: request.id, error: error instanceof Error ? error.message : String(error) };
        port.postMessage(reply);
    }
});
port.postMessage({ ready: true });
//# sourceMappingURL=worker.js.map