import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import type { CommandContext } from "safe-bash-contracts";
import { createXzCommand } from "./command.js";

test("XZ round-trips every byte without a Node Buffer global", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
  try {
    const original = Uint8Array.from({ length: 256 }, (_, index) => index);
    let input = original;
    for (const args of [["-c"], ["-dc"]]) {
      const output: Uint8Array[] = [];
      let stderr = "";
      const context: CommandContext = {
        command: "xz", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
        signal: new AbortController().signal,
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      };
      assert.equal((await createXzCommand().execute(context)).exitCode, 0, stderr);
      input = new Uint8Array(output.reduce((length, bytes) => length + bytes.length, 0));
      let offset = 0;
      for (const bytes of output) {
        input.set(bytes, offset);
        offset += bytes.length;
      }
    }
    assert.deepEqual(input, original);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
});
