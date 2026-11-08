import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitCommand } from "safe-bash-command-git";
import { Shell } from "../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

test("default Git shares immutable compiled code but allocates an instance per invocation", async (t) => {
  const result = new TextEncoder().encode(
    JSON.stringify({ exitCode: 0, stdout: "git isolated\n", stderr: "", entries: null })
  );
  const memories: ArrayBuffer[] = [];
  const runtime = globalThis as unknown as {
    WebAssembly: { Instance: new (module: object) => object };
  };
  t.mock.method(runtime.WebAssembly, "Instance", function () {
    const buffer = new ArrayBuffer(65536);
    memories.push(buffer);
    new Uint8Array(buffer, 8192, result.length).set(result);
    return {
      exports: {
        memory: { buffer },
        git_alloc: () => 0,
        git_free() {},
        git_execute: () => 8192,
        git_output_len: () => result.length
      }
    };
  });
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.register(createGitCommand());
  t.after(() => shell.dispose());
  assert.equal((await shell.exec("git --version")).exitCode, 0);
  assert.equal((await shell.exec("git --version")).exitCode, 0);
  assert.equal(memories.length, 2);
  assert.notEqual(memories[0], memories[1]);
});
