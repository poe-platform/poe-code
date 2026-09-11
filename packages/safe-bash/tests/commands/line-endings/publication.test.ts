import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { lineEndingCommands } from "../../../src/commands/line-endings/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";

for (const command of ["dos2unix", "unix2dos"]) {
  test(`${command} preserves a destination created after the publication precheck`, async () => {
    const memory = new MemoryFileSystem();
    const input = Buffer.from("input\r\n");
    const concurrent = Buffer.from("concurrent writer\n");
    await memory.writeFile("/in", input);
    let entered!: () => void, release!: () => void;
    const admission = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const fs: FileSystem = new Proxy(memory, {
      get(target, key) {
        if (key === "rename") return async (...args: Parameters<FileSystem["rename"]>) => {
          entered();
          await barrier;
          return await memory.rename(...args);
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const shell = new Shell({ fs }).use(lineEndingCommands());
    const execution = shell.exec(`${command} -q -n /in /out`);
    try {
      await admission;
      await memory.writeFile("/out", concurrent, { flag: "wx" });
      release();
      const result = await execution;
      assert.deepEqual(Buffer.from(await memory.readFile("/out")), concurrent);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(Buffer.from(await memory.readFile("/in")), input);
      assert.deepEqual((await memory.readdir("/")).map(entry => entry.name).sort(), ["in", "out"]);
    } finally {
      release();
      await execution.catch(() => {});
      await shell.dispose();
    }
  });

  for (const supported of [true, false, undefined]) {
    test(`${command} admits an absent destination only with no-replace capability ${supported}`, async () => {
      const memory = new MemoryFileSystem();
      await memory.writeFile("/in", Buffer.from("input\r\n"));
      let mutations = 0;
      const capabilities = { ...memory.capabilities, atomicRenameNoReplace: supported };
      const fs: FileSystem = new Proxy(memory, {
        get(target, key) {
          if (key === "capabilitiesFor") return async () => capabilities;
          const value: unknown = Reflect.get(target, key, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (["writeFile", "appendFile", "chmod", "utimes", "rename", "rm"].includes(String(key))) mutations++;
            return Reflect.apply(value, target, args);
          };
        },
      });
      const shell = new Shell({ fs }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} -q -n /in /out`);
        assert.equal(result.exitCode, supported ? 0 : 1);
        if (supported) {
          assert.equal(Buffer.from(await memory.readFile("/out")).toString(), command === "dos2unix" ? "input\n" : "input\r\n");
        } else {
          assert.equal(mutations, 0);
          assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["in"]);
          // Existing targets still use ordinary atomic replacement.
          assert.equal((await shell.exec(`${command} -q /in`)).exitCode, 0);
        }
      } finally { await shell.dispose(); }
    });
  }
}
