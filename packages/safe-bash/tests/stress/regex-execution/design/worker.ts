import { parentPort } from "node:worker_threads";
import { compile, scan } from "./matching.js";
import { descriptors, rows } from "./protocol.js";

if (!parentPort) throw new Error("WORKER_ONLY");
const port = parentPort;
let expected = 1;
let patterns: RegExp[] | undefined;
port.on("message", (message: unknown) => {
  const request = message as { id: number; kind: string; data: unknown };
  try {
    if (!request || Object.keys(request).sort().join() !== "data,id,kind" || request.id !== expected++) throw new Error("REQUEST_PROTOCOL");
    if (request.kind === "init" && !patterns) {
      descriptors(request.data);
      patterns = compile(request.data);
      port.postMessage({ id: request.id, ok: true, data: null });
    } else if (request.kind === "scan" && patterns) {
      rows(request.data);
      port.postMessage({ id: request.id, ok: true, data: scan(patterns, request.data) });
    } else throw new Error("REQUEST_PROTOCOL");
  } catch (error) {
    port.postMessage({ id: request?.id, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 512) });
  }
});
port.postMessage({ ready: true });
