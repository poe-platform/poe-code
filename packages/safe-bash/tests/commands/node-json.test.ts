import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

for (const input of ["eval", "print", "file", "stdin"]) {
  test(`node requires relative JSON from ${input} source`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.mkdir("/work/scripts");
    await fs.writeFile("/work/data.json", Buffer.from('{"n":3}\n'));
    await fs.writeFile("/work/scripts/data.json", Buffer.from('{"n":4}\n'));
    const source = 'console.log(require("./data.json").n)';
    await fs.writeFile("/work/scripts/main.js", Buffer.from(source));
    const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(input === "file" ? "node scripts/main.js a b"
        : input === "stdin" ? "node - a b"
        : input === "print" ? `node -p 'require("./data.json").n' a b`
        : `node -e '${source}' a b`, input === "stdin" ? { stdin: source } : {});
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, input === "file" ? "4\n" : "3\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("node caches guest JSON values by resolved path within one invocation", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/data.json", Buffer.from('\uFEFF{"n":3,"items":[null,true]}'));
  const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -e '
      const data = require("./data.json");
      data.n = 7;
      await require("fs").writeFile("data.json", "null", "utf8");
      console.log(data === require("./../work/data.json"), require("/work/data.json").n, data.items);
    '`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "true 7 [null,true]\n");
    assert.equal((await shell.exec(`node -p 'require("./data.json")'`)).stdout, "null\n");
  } finally { await shell.dispose(); }
});

test("node JSON loading throws at the call site and does not cache failed parses", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/bad.json", Buffer.from("{"));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -e '
      try { require("./missing.json"); } catch (error) { console.log(error.code); }
      try { require("./bad.json"); } catch (error) { console.log(error.name); }
      await require("fs").writeFile("bad.json", "[1,true,null]", "utf8");
      console.log(require("./bad.json"));
      for (const name of ["data.json", "./local.js", "node:child_process"]) {
        try { require(name); console.log("loaded"); } catch (error) { console.log(error.name); }
      }
    '`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "MODULE_NOT_FOUND\nSyntaxError\n[1,true,null]\nTypeError\nTypeError\nTypeError\n");
  } finally { await shell.dispose(); }
});

for (const limits of [{ stringLength: 1024 }, { arrayLength: 2 }, { maxOutputBytes: 2 }]) {
  test(`node JSON loading retains value and output limits: ${JSON.stringify(limits)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.json", Buffer.from(JSON.stringify(["a".repeat(2048), 2, 3])));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits }));
    try {
      const result = await shell.exec(`node -p 'require("./data.json")'`);
      assert.equal(result.exitCode, 124, result.stderr);
    } finally { await shell.dispose(); }
  });
}

test("node JSON loading propagates caller cancellation to the virtual read", async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  class PendingFileSystem extends MemoryFileSystem {
    override async readFile(path: string, options?: Parameters<MemoryFileSystem["readFile"]>[1]): Promise<Uint8Array> {
      if (path !== "/data.json") return super.readFile(path, options);
      const signal = options?.signal;
      assert.ok(signal);
      signal.throwIfAborted();
      started();
      return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    }
  }
  const shell = new Shell({ fs: new PendingFileSystem() }).use(nodeCommands({ runtime }));
  const controller = new AbortController();
  const reason = new Error("cancel virtual JSON read");
  try {
    const pending = shell.exec(`node -p 'require("./data.json")'`, { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  } finally { await shell.dispose(); }
});
