import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Compile once and reuse Node; each request constructs its own document and budget. */
export async function prepareNativeModelScript(body: string) {
  const result = await build({
    stdin: {
      contents: `import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Volume } from "memfs";
import * as api from "./index.js";
import { ModelStore } from "./model-store.js";
import { archiveSettings } from "./archive.js";
console.log("ready");
for await (const data of createInterface({ input: createReadStream(null, { fd: 3 }) })) {
const request = JSON.parse(data);
${body}
}`,
      resolveDir: fileURLToPath(new URL("../../src/", import.meta.url)),
      loader: "js"
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    write: false
  });
  const script = result.outputFiles[0]!.text;
  return async () => {
    const child = spawn(process.execPath, ["--input-type=module"], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    const input = child.stdio[3] as Writable;
    const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let stderr = "";
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    const completion = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.stdin.on("error", reject);
      input.on("error", reject);
      child.on("close", code => {
        if (code !== 0) reject(new Error(stderr || "Native model exited unexpectedly"));
        else resolve();
      });
    });
    void completion.catch(() => {});
    // Separate pipes keep compilation and imports in setup, and model work in the test.
    child.stdin.end(script);
    const ready = await replies.next();
    assert.equal(ready.done, false, stderr);
    assert.equal(ready.value, "ready");
    let pending = false;
    return {
      async run(request: unknown, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        assert.equal(pending, false, "Native requests must be sequential");
        pending = true;
        const abort = () => { child.kill(); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          await new Promise<void>((resolve, reject) => {
            input.write(JSON.stringify(request) + "\n", error => error ? reject(error) : resolve());
          });
          const reply = await replies.next();
          signal.throwIfAborted();
          assert.equal(reply.done, false, stderr);
          return reply.value;
        } finally {
          pending = false;
          signal.removeEventListener("abort", abort);
        }
      },
      async dispose(): Promise<void> {
        if (pending) child.kill();
        input.end();
        await completion;
      }
    };
  };
}
