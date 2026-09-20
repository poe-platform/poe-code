import assert from "node:assert/strict";
import { fork as forkChild } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function runVitestBatch(root, files, { fork = forkChild } = {}) {
  const child = fork(fileURLToPath(new URL("./vitest-batch-worker.mjs", import.meta.url)), [], {
    stdio: ["inherit", "inherit", "inherit", "ipc"]
  });
  return await new Promise((resolve, reject) => {
    let result, failure;
    child.on("message", message => {
      if (result !== undefined) failure = new Error("Multiple unit batch results");
      else result = message;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      try {
        if (failure) throw failure;
        assert.ok(code === 0 && signal === null && result?.ok === true, result?.error ?? "Unit batch process failed");
        assert.ok(Array.isArray(result.files) && result.files.length === files.length, "Incomplete unit batch result");
        assert.deepEqual(new Set(result.files), new Set(files), "Unit batch file identities changed");
        resolve(result.files);
      } catch (error) { reject(error); }
    });
    try { child.send({ root, files }); } catch (error) { child.kill(); reject(error); }
  });
}
