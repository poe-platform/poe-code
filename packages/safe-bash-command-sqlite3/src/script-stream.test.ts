import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type ByteSource } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";

const encoder = new TextEncoder();
for (const mode of ["read", "init", "stdin"] as const) {
  test(`sqlite3 stages ${mode} scripts with bounded caller-backed transfers`, async () => {
    const fs = createMemoryFileSystem();
    const payload = encoder.encode('\ufeff' + '.print "é😀"\r\n'.repeat(12000));
    let opened = 0, closed = 0, maxTransfer = 0, output = "", errors = "";
    const source: ByteSource = { async *[Symbol.asyncIterator]() {
      const scratch = new Uint8Array(4093);
      for (let offset = 0; offset < payload.length; offset += scratch.length) {
        const part = payload.subarray(offset, offset + scratch.length); scratch.set(part);
        yield scratch.subarray(0, part.length);
      }
    } };
    const filesystem = new Proxy(fs, { get(target, key) {
      if (key === "readFile") return () => { throw new Error("whole script read forbidden"); };
      if (key === "readStream") return () => source;
      if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args); opened++;
        return new Proxy(handle, { get(target, key) {
          if (key === "read" || key === "write") return async (...args: Parameters<typeof handle.read>) => {
            maxTransfer = Math.max(maxTransfer, args[0].length);
            return key === "read" ? handle.read(...args) : handle.write(...args);
          };
          if (key === "close") return async () => { closed++; await handle.close(); };
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    await fs.writeFile("/script", payload);
    const args = mode === "read" ? [":memory:", ".read /script"] : mode === "init" ? ["-init", "/script", ":memory:"] : [":memory:"];
    const result = await createSqlite3Command().execute({ command: "sqlite3", ...createCommandArguments(args),
      cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
      stdin: mode === "stdin" ? source : { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } } });
    assert.equal(result.exitCode, 0, errors);
    assert.equal(output, 'é😀\n'.repeat(12000));
    assert.ok(opened > 0); assert.equal(closed, opened);
    assert.ok(maxTransfer > 0 && maxTransfer <= 16384);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["script"]);
  });
}

for (const outcome of ["read-error", "limit", "cancel", "quit"] as const) {
  test(`sqlite3 cleans staged scripts on ${outcome} without premature execution`, async () => {
    const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("script interrupted");
    let opened = 0, closed = 0, returned = false, output = "", diagnostic = "";
    const filesystem = new Proxy(fs, { get(target, key) {
      if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args); opened++;
        return new Proxy(handle, { get(target, key) {
          if (key === "close") return async () => { closed++; await handle.close(); };
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const source: ByteSource = { async *[Symbol.asyncIterator]() {
      try {
        yield encoder.encode(outcome === "quit" ? '.quit\n' : '.print premature\n');
        for (let i = 0; i < 8; i++) yield encoder.encode('.print ignored\n'.repeat(1024));
        if (outcome === "read-error") throw failure;
        if (outcome === "cancel") controller.abort(failure);
      } finally { returned = true; }
    } };
    const run = createSqlite3Command({ limits: outcome === "limit" ? { maxInputBytes: 100000 } : {} }).execute({
      command: "sqlite3", ...createCommandArguments([":memory:"]), cwd: "/", env: {}, fs: filesystem,
      signal: controller.signal, stdin: source,
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    if (outcome === "cancel") await assert.rejects(Promise.resolve(run), error => error === failure);
    else {
      assert.equal((await run).exitCode, outcome === "quit" ? 0 : 1);
      if (outcome === "read-error") assert.match(diagnostic, /script interrupted/);
      if (outcome === "limit") assert.match(diagnostic, /maxInputBytes/);
    }
    assert.equal(output, ""); assert.equal(returned, true);
    assert.ok(opened > 0); assert.equal(closed, opened);
    assert.deepEqual(await fs.readdir("/"), []);
  });
}
