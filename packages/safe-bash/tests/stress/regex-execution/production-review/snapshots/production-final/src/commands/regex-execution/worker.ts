import { parentPort } from "node:worker_threads";
import { compile } from "./matching.js";
import type { Request, Reply } from "./protocol.js";

if (!parentPort) throw new Error("regex worker requires a parent port");
const port = parentPort;
let previous = "";
let matcher: ReturnType<typeof compile> | undefined;
port.on("message", (request: Request) => {
  let reply: Reply;
  try {
    const identity = JSON.stringify(request.descriptor);
    if (identity !== previous || !matcher) {
      matcher = undefined;
      matcher = compile(request.descriptor);
      previous = identity;
    }
    const results = request.rows.map(row => {
      const matches = matcher!(row.bytes, row.all, row.terminated);
      const ranges = new Float64Array(matches.length * 2);
      for (let index = 0; index < matches.length; index++) {
        ranges[index * 2] = matches[index]!.start;
        ranges[index * 2 + 1] = matches[index]!.end;
      }
      return ranges;
    });
    reply = { id: request.id, results };
    port.postMessage(reply, results.map(result => result.buffer));
  } catch (error) {
    reply = { id: request.id, error: error instanceof Error ? error.message : String(error) };
    port.postMessage(reply);
  }
});
port.postMessage({ ready: true });
