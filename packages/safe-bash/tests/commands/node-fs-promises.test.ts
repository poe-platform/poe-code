import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

for (const name of ["fs/promises", "node:fs/promises"]) {
  for (const input of ["inline", "file", "stdin"]) {
    test(`node imports ${name} from ${input} source using the VFS`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", Buffer.from("abc\n"));
      const source = `import {readFile, writeFile} from "${name}"; console.log(await readFile("input", "utf8")); await writeFile("output", "saved", "utf8");`;
      await fs.writeFile("/script.mjs", Buffer.from(source));
      const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
      try {
        const result = await shell.exec(input === "inline" ? `node --input-type=module -e '${source}'`
          : input === "file" ? "node script.mjs" : "node --input-type=module", input === "stdin" ? { stdin: source } : {});
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "abc\n\n");
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(await fs.readFile("/output")).toString(), "saved");
      } finally { await shell.dispose(); }
    });
  }

  test(`node supports default and namespace imports of ${name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abc\n"));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node -e 'import fs from "${name}"; import * as promises from "${name}"; console.log(await fs.readFile("input", "utf8")); console.log(await promises.readFile("input", "utf8"));'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "abc\n\nabc\n\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("node filesystem promise imports retain interpreter and output limits", async () => {
  for (const [limits, source] of [
    [{ maxSteps: 2000 }, 'import {readFile} from "fs/promises"; while (true) {}'],
    [{ maxOutputBytes: 2 }, 'import {readFile} from "node:fs/promises"; console.log(await readFile("input", "utf8"))'],
  ] as const) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abc\n"));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits }));
    try {
      const result = await shell.exec(`node -e '${source}'`);
      assert.equal(result.exitCode, 124, result.stderr);
    } finally { await shell.dispose(); }
  }
});

test("node filesystem promise imports propagate caller cancellation to VFS reads", async () => {
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  class PendingFileSystem extends MemoryFileSystem {
    override async readFile(path: string, options?: Parameters<MemoryFileSystem["readFile"]>[1]): Promise<Uint8Array> {
      if (path !== "/input") return super.readFile(path, options);
      const signal = options?.signal;
      assert.ok(signal);
      signal.throwIfAborted();
      started();
      return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    }
  }
  const shell = new Shell({ fs: new PendingFileSystem() }).use(nodeCommands({ runtime }));
  const controller = new AbortController();
  const reason = new Error("cancel virtual read");
  try {
    const pending = shell.exec('node -e \'import {readFile} from "node:fs/promises"; await readFile("input", "utf8");\'', { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  } finally { await shell.dispose(); }
});

for (const name of ["node:fs", "node:child_process", "./local.mjs", "https://example.com/module.mjs"]) {
  test(`node does not load unregistered module ${name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/local.mjs", Buffer.from('console.log("loaded"); export const readFile = () => "host";'));
    const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node -e 'import {readFile} from "${name}"; console.log("loaded");'`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
}
