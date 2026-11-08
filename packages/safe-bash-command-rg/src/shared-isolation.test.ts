import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Limits } from "./shared.js";

test("fresh output limits cannot replay another invocation's buffered bytes", async () => {
  let output = "";
  const append = (bytes: Uint8Array) => { output += new TextDecoder().decode(bytes); };
  const context: CommandContext = {
    command: "rg", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      ...{
        writeSync(bytes: Uint8Array) { append(bytes); return true; },
        writeRangeSync(bytes: Uint8Array, length: number) { append(bytes.subarray(0, length)); return true; },
      },
      async write(bytes) { append(bytes); },
    },
    stderr: { async write() {} },
  };
  const first = new Limits(context, {});
  await first.outputSyncOrAsync("tenant-secret");
  await first.flushSyncOrAsync();
  assert.equal(output, "tenant-secret");
  output = "";
  const second = new Limits(context, {});
  const obsolete = Reflect.get(second, "flushCachedSharedSync") as ((length: number) => boolean) | undefined;
  obsolete?.call(second, 13);
  await second.flushSyncOrAsync();
  assert.equal(output, "", "a fresh invocation must not emit previous output");
  assert.equal(obsolete, undefined);
  await second.outputSyncOrAsync("own");
  await second.flushSyncOrAsync();
  assert.equal(output, "own");
});
