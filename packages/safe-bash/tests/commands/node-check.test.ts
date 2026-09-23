import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, parseSourceModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, parseSourceModule,
  createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

for (const flag of ["--check", "-c"]) {
  for (const input of ["file", "stdin"]) {
    test(`node ${flag} checks ${input} syntax without executing it`, async () => {
      const source = 'console.log("executed"); require("fs").writeFile("effect", "bad"); throw new Error("executed");';
      const native = spawnSync(process.execPath, [flag, "-"], { input: source, encoding: "utf8" });
      assert.equal(native.status, 0, native.stderr);
      const fs = new MemoryFileSystem();
      await fs.mkdir("/work");
      await fs.writeFile("/work/script.js", Buffer.from(source));
      const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
      try {
        const result = await shell.exec(`node ${flag}${input === "file" ? " script.js" : ""}`, { stdin: source });
        assert.equal(result.exitCode, native.status, result.stderr);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.stderr, native.stderr);
        await assert.rejects(fs.stat("/work/effect"));
      } finally { await shell.dispose(); }
    });
  }
}

test("node syntax checking rejects trailing invalid syntax with status 1", async () => {
  const source = 'console.log("executed"); const = ;';
  const native = spawnSync(process.execPath, ["--check", "-"], { input: source, encoding: "utf8" });
  assert.equal(native.status, 1);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("node -c -", { stdin: source });
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unexpected token/);
  } finally { await shell.dispose(); }
});

test("node syntax checking parses modules without resolving imports", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/script.mjs", Buffer.from('\uFEFF#!/usr/bin/env node\nimport missing from "./missing.mjs"; import native from "node:child_process"; await missing();'));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("node --check -- script.mjs");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const selector of ["-e 'console.log(1)'", "-p '1'"]) {
  test(`node syntax checking refuses conflicting selector ${selector}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
    try {
      for (const command of [`node -c ${selector}`, `node ${selector} --check`]) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, 2, result.stderr);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /conflicting source selectors/);
      }
    } finally { await shell.dispose(); }
  });
}

test("node syntax checking requires an explicitly injected parser", async () => {
  const { parseSourceModule: ignoredParser, ...withoutParser } = runtime;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: withoutParser }));
  try {
    const result = await shell.exec("node -c -", { stdin: "console.log(1)" });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /inject.*parseSourceModule/);
  } finally { await shell.dispose(); }
});

test("node syntax checking preserves source limits", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime, limits: { maxSourceBytes: 4 } }));
  try {
    const result = await shell.exec("node -c -", { stdin: "console.log(1)" });
    assert.equal(result.exitCode, 124, result.stderr);
    assert.match(result.stderr, /maxSourceBytes/);
  } finally { await shell.dispose(); }
});

test("node syntax checking propagates cancellation during a virtual source read", async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  class PendingFileSystem extends MemoryFileSystem {
    override async *readStream(path: string, options?: Parameters<MemoryFileSystem["readStream"]>[1]): AsyncGenerator<Uint8Array> {
      yield await this.readFile(path, options);
    }
    override async readFile(path: string, options?: Parameters<MemoryFileSystem["readFile"]>[1]): Promise<Uint8Array> {
      if (path !== "/pending.js") return super.readFile(path, options);
      const signal = options?.signal;
      assert.ok(signal);
      signal.throwIfAborted();
      started();
      return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    }
  }
  const fs = new PendingFileSystem();
  await fs.writeFile("/pending.js", Buffer.from("console.log(1)"));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  const controller = new AbortController();
  const reason = new Error("cancel syntax source read");
  try {
    const pending = shell.exec("node --check pending.js", { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  } finally { await shell.dispose(); }
});

test("node syntax checking propagates cancellation after parser admission", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel syntax parser");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
    ...runtime, parseSourceModule(source, filename) {
      controller.abort(reason);
      return parseSourceModule(source, filename);
    },
  } }));
  try {
    await assert.rejects(shell.exec("node -c -", { stdin: "console.log(1)", signal: controller.signal }), error => error === reason);
  } finally { await shell.dispose(); }
});
