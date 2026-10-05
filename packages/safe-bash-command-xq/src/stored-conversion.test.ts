import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createXqCommand } from "./index.js";

for (const scenario of ["success", "cancel", "write", "early"] as const) test(`xq converts generated XML through caller-backed pages (${scenario})`, async () => {
  const fs = createMemoryFileSystem(), encoder = new TextEncoder(), controller = new AbortController(), failure = new Error("conversion backing failed");
  let inputFinished = false;
  let opened = 0, closed = 0, written = 0, output = "";
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("conversion must use bounded descriptor I/O");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); written += args[0].length;
          if (inputFinished && (scenario === "cancel" || scenario === "write")) { if (scenario === "cancel") controller.abort(failure); throw failure; }
          return handle.write(...args);
        };
        if (member === "close") return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = Promise.resolve(createXqCommand().execute({ command: "xq", ...createCommandArguments(scenario === "early" ? ["--stream", "halt"] : [".r.x | length"]), cwd: "/", env: {}, fs: injected,
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      try {
        yield encoder.encode("<r>"); const bytes = encoder.encode(`<x>${"a".repeat(16384)}</x>`);
        for (let index = 0; index < 80; index++) yield bytes;
        yield encoder.encode("</r>");
      } finally { inputFinished = true; }
    } }, stdout: { async write(bytes) { await Promise.resolve(); output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { if (bytes.length) assert.fail(new TextDecoder().decode(bytes)); } },
  }));
  if (scenario === "success") { assert.equal((await result).exitCode, 0); assert.equal(output, "80\n"); }
  else if (scenario === "early") { assert.equal((await result).exitCode, 0); assert.equal(output, ""); }
  else { await assert.rejects(result, error => error === failure); assert.equal(output, ""); }
  assert.ok(written > 1024 * 1024, "XML conversion must spill into caller backing");
  assert.ok(opened >= 1 && opened <= 3, "only source, ancestry and document backing may be opened"); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/"), []);
});
