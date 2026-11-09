import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandInput } from "safe-bash-contracts";
import { createCommCommand } from "./index.js";

for (const separator of [10, 0]) {
  for (const bounded of [false, true]) {
    test(`comm preserves remaining descriptor bytes with separator=${separator}, readAvailable=${bounded}`, async () => {
      const bytes = Uint8Array.of(111, 110, 101, separator, 116, 119, 111, separator);
      let position = 0;
      const input: CommandInput = {
        get position() { return position; },
        async read(maxBytes) {
          const value = bytes.slice(position, position + maxBytes);
          position += value.length;
          return value.length ? { done: false, value } : { done: true, value: undefined };
        },
        ...(bounded ? { async readAvailable(maxBytes: number, signal: AbortSignal, delimiter?: number) {
          const end = delimiter === undefined ? -1 : bytes.indexOf(delimiter, position);
          return input.read(Math.min(maxBytes, end < 0 ? bytes.length - position : end + 1 - position), signal);
        } } : {}),
      };
      let stdout = "", stderr = "";
      const result = await createCommCommand().execute({
        command: "comm", args: [...(separator === 0 ? ["-z"] : []), "-", "missing"],
        cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(bytes), stdinInput: input,
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes("missing"), stderr);
      assert.equal(stdout, "");
      assert.equal(position, 4);
      assert.deepEqual((await input.read(4, new AbortController().signal)).value, bytes.subarray(4));
    });
  }
}
