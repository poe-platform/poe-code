import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Budget, declareHostOperation, makeFsModule, parseSourceModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, parseSourceModule, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

for (const flag of ["--require ./data.json", "--require=./data.json", "-r ./data.json", "-r./data.json"]) {
  test(`node preloads virtual JSON using ${flag}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.json", Buffer.from('{"n":3}'));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node ${flag} -e 'console.log(3)'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "3\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const selector of ["-e 'console.log(globalThis.loaded)'", "-p 'globalThis.loaded'", "scripts/main.js", "--input-type=module scripts/main.mjs", "-", "--input-type=commonjs -"]) {
  test(`node executes CommonJS preloads before ${selector}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/scripts", { recursive: true });
    await fs.writeFile("/work/owned.cjs", Buffer.from('globalThis.loaded = "loaded-public"; console.log(__filename, __dirname, this === exports); module.exports.n = 3;'));
    await fs.writeFile("/work/scripts/main.js", Buffer.from('console.log(globalThis.loaded);'));
    await fs.writeFile("/work/scripts/main.mjs", Buffer.from('console.log(globalThis.loaded);'));
    const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node -r ./owned.cjs ${selector}`, { stdin: 'console.log(globalThis.loaded);' });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "/work/owned.cjs /work true\nloaded-public\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("node preloads share ordered CommonJS cache, relative dependencies and cycles", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/lib", { recursive: true });
  await fs.writeFile("/work/lib/a.cjs", Buffer.from('exports.n = 3; const b = require("./b.js"); console.log("a", b.n); globalThis.value = b;'));
  await fs.writeFile("/work/lib/b.js", Buffer.from('module.exports = require("./a.cjs");'));
  await fs.writeFile("/work/second.cjs", Buffer.from('console.log("second", require("./lib/a.cjs") === globalThis.value);'));
  const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -r ./lib/a.cjs --require ./lib/../lib/a.cjs -r ./second.cjs -e 'console.log(require("./lib/a.cjs").n)'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a 3\nsecond true\n3\n");
    assert.equal((await shell.exec(`node -p 'typeof globalThis.value'`)).stdout, "undefined\n");
  } finally { await shell.dispose(); }
});

test("node preload failures prevent entry execution and check mode skips preloads", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/bad.json", Buffer.from("{"));
  await fs.writeFile("/bad.cjs", Buffer.from('console.log("effect"); import fs from "fs";'));
  await fs.writeFile("/throw.cjs", Buffer.from('throw new Error("preload failed");'));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    for (const name of ["./missing.cjs", "./bad.json", "./bad.cjs", "./throw.cjs", "node:child_process", "some-package"]) {
      const result = await shell.exec(`node -r ${name} -e 'console.log("entry")'`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "", name);
    }
    const checked = await shell.exec(`node -r ./missing.cjs --check`, { stdin: "console.log(3);" });
    assert.equal(checked.exitCode, 0, checked.stderr);
    assert.equal(checked.stdout, "");
    for (const flag of ["--require", "--require=", "-r"]) {
      assert.equal((await shell.exec(`node ${flag}`)).exitCode, 2);
    }
  } finally { await shell.dispose(); }
});

for (const [limits, source] of [
  [{ maxSourceBytes: 24 }, 'console.log("too much source");'],
  [{ maxSteps: 1000 }, "while (true) {}"],
  [{ maxOutputBytes: 2 }, "console.log(123);"],
] as const) {
  test(`node preload preserves limits ${JSON.stringify(limits)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/owned.cjs", Buffer.from(source));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits }));
    try {
      const result = await shell.exec(`node -r ./owned.cjs -e '0'`);
      assert.equal(result.exitCode, 124, result.stderr);
    } finally { await shell.dispose(); }
  });
}

test("node preload propagates cancellation to virtual source reads", async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  class PendingFileSystem extends MemoryFileSystem {
    override async *readStream(path: string, options?: Parameters<MemoryFileSystem["readStream"]>[1]): AsyncIterable<Uint8Array> {
      if (path !== "/owned.cjs") { yield* super.readStream(path, options); return; }
      const signal = options?.signal;
      assert.ok(signal);
      signal.throwIfAborted();
      started();
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  }
  const shell = new Shell({ fs: new PendingFileSystem() }).use(nodeCommands({ runtime }));
  const controller = new AbortController();
  const reason = new Error("cancel preload");
  try {
    const pending = shell.exec(`node -r ./owned.cjs -e '0'`, { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  } finally { await shell.dispose(); }
});

test("node module source limits include the file entry and every uncached dependency", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/main.js", Buffer.from('console.log("entry");'));
  await fs.writeFile("/a.cjs", Buffer.from('require("./b.cjs");'));
  await fs.writeFile("/b.cjs", Buffer.from('exports.n = 3;'));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits: { maxSourceBytes: 40 } }));
  try {
    const result = await shell.exec("node -r ./a.cjs main.js");
    assert.equal(result.exitCode, 124, result.stderr);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("node builtin preloads and option termination match native Node", async () => {
  const args = ["-r", "node:path", "--require=node:fs", "-e", 'console.log(require("node:path").basename("/work/file")); console.log(process.argv.slice(1).join("|"));', "--", "--require", "./missing.cjs"];
  const native = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { NODE_OPTIONS: "--require /host/private.cjs" } }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("node " + args.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" "));
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
  } finally { await shell.dispose(); }
});

test("node CommonJS modules handle shebangs, BOMs, failed-load retry and preload timers", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/setup.cjs", Buffer.from('\uFEFF#!/virtual/bin/node\nconst path = require("node:path"); globalThis.loaded = path.basename(__filename); setTimeout(() => { console.log("timer"); process.exitCode = 7; }, 1);'));
  await fs.writeFile("/retry.cjs", Buffer.from('throw new Error("retry");'));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -r ./setup.cjs -e '
      console.log(globalThis.loaded);
      try { require("./retry.cjs"); } catch (error) { console.log(error.message); }
      await require("fs").writeFile("retry.cjs", "module.exports = 3;", "utf8");
      console.log(require("./retry.cjs"));
    '`);
    assert.equal(result.exitCode, 7, result.stderr);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines.filter(line => line === "timer").length, 1);
    assert.deepEqual(lines.filter(line => line !== "timer"), ["setup.cjs", "retry", "3"]);
  } finally { await shell.dispose(); }
});
