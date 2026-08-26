import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const root = realpathSync(process.env.SAFEJS_LOCAL_ROOT);
const runPath = realpathSync(join(root, "src/run.ts"));
const interpreterPath = realpathSync(join(root, "src/interp/interpreter.ts"));
assert(runPath.startsWith(`${root}/`));
assert(interpreterPath.startsWith(`${root}/`));
console.log(JSON.stringify({ runPath, interpreterPath }));
const { run } = await import(pathToFileURL(runPath).href);
const { declareHostOperation } = await import(pathToFileURL(join(root, "src/interp/host-bridge.ts")).href);
const controller = new AbortController();
const abortReason = new Error("abort inside host action");
let calls = 0;
const action = {
  stop: declareHostOperation(() => {
    calls += 1;
    controller.abort(abortReason);
    return Promise.reject(new Error("host action late rejection"));
  }, "read-side-effect"),
};
await assert.rejects(
  run('import { stop } from "action"; await stop();', { signal: controller.signal, modules: { action } }),
  error => error.message === abortReason.message,
);
assert.equal(calls, 1);
console.log("outward abort observed");
await delay(50);
console.log("completed without unhandled rejection");
