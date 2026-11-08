import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { write } from "./commands/text-programs/shared.js";

test("synchronous text output stays isolated during reentrant writes", async () => {
  const outputs: string[] = [];
  let nested = false;
  const context = {
    signal: new AbortController().signal,
    stdout: {
      writeRangeSync(chunk: Uint8Array, length: number) {
        if (!nested) {
          nested = true;
          void write(context, "tenant-B");
        }
        outputs.push(new TextDecoder().decode(chunk.subarray(0, length)));
        return true;
      },
    },
  } as unknown as CommandContext;
  await write(context, "tenant-A");
  assert.deepEqual(outputs, ["tenant-B", "tenant-A"]);
});
