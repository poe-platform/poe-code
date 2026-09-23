import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

test("node invokes fs.readFile callbacks before completing the command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc\n"));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node --input-type=module -e 'import {readFile} from "fs"; readFile("input","utf8",(error,text)=>console.log(error?error.code:text))'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "abc\n\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const moduleName of ["fs", "node:fs"]) {
  test(`node supports callback reads, errors, and Promise reads through ${moduleName}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abc\n"));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node -e '
        const fs = require("${moduleName}");
        let complete;
        const completion = new Promise(resolve => { complete = resolve; });
        const returned = fs.readFile("input", {encoding:"utf8"}, (error, text) => {
          console.log(error === null, text === "abc\\n");
          complete();
        });
        console.log(returned === undefined);
        await completion;
        await new Promise(resolve => fs.readFile("missing", "utf8", (error, text) => {
          console.log(error.code, text === undefined);
          resolve();
        }));
        console.log(await fs.promises.readFile("input", "utf8"));
        console.log(await fs.readFile("input", "utf8"));
      '`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "true\ntrue true\nENOENT true\nabc\n\nabc\n\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("node drains reads and timers admitted by each other's callbacks", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc"));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -e '
      const fs = require("fs");
      fs.readFile("input", "utf8", (error, text) => {
        setTimeout(() => {
          fs.readFile("input", "utf8", (error, again) => {
            console.log(text, again);
            process.exitCode = 7;
          });
        }, 1);
      });
    '`);
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stdout, "abc abc\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("node reports filesystem callback failures and applies shared limits", async () => {
  for (const [limits, body, status] of [
    [{}, 'throw new Error("callback failure")', 1],
    [{maxOutputBytes:2}, 'console.log("large")', 124],
    [{maxSteps:1000}, 'while (true) {}', 124],
  ] as const) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abc"));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits }));
    try {
      const result = await shell.exec(`node -e 'require("fs").readFile("input", "utf8", () => { ${body}; })'`);
      assert.equal(result.exitCode, status, result.stderr);
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  }
});

test("node bounds admission of filesystem callbacks", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime, limits:{arrayLength:1} }));
  try {
    const result = await shell.exec(`node -e '
      setTimeout(() => {}, 1000);
      try { require("fs").readFile("input", "utf8", () => console.log("late")); } catch (error) {}
    '`);
    assert.equal(result.exitCode, 124, result.stderr);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("node cancels an in-flight callback read without delivering output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel callback read");
  let delivered = false;
  class PendingFileSystem extends MemoryFileSystem {
    override async readFile(path: string, options?: Parameters<MemoryFileSystem["readFile"]>[1]): Promise<Uint8Array> {
      if (path !== "/input") return super.readFile(path, options);
      controller.abort(reason);
      return Buffer.from("late");
    }
  }
  const shell = new Shell({ fs: new PendingFileSystem() }).use(nodeCommands({ runtime:{
    ...runtime,
    run(source, options) {
      return run(source, { ...options, sink: { log() { delivered = true; }, error() {} } });
    },
  } }));
  try {
    await assert.rejects(shell.exec(`node -e 'require("fs").readFile("input", "utf8", () => console.log("late"))'`, {signal:controller.signal}), error => error === reason);
    assert.equal(delivered, false);
  } finally { await shell.dispose(); }
});

test("node validates an explicitly supplied readFile callback synchronously", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec(`node -e '
      try { require("fs").readFile("input", "utf8", 1); }
      catch (error) { console.log(error.name); }
    '`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "TypeError\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
