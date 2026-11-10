import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

for (const serial of [false, true]) {
 for (const separator of [10, 0]) {
  for (const terminated of [false, true]) {
   for (const split of [false, true]) {
    test(`paste preserves input before EIO: serial=${serial}, separator=${separator}, terminated=${terminated}, split=${split}`, async () => {
     const values = createCommandArguments([...(serial ? ["-s"] : []), ...(separator === 0 ? ["-z"] : []), "-"]);
     const stdout: number[] = [];
     let stderr = "";
     const result = await createPasteCommand().execute({
      command: "paste", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: (async function* () {
       yield Uint8Array.of(112, separator, 113);
       if (split) yield Uint8Array.of(114);
       if (terminated) yield Uint8Array.of(separator);
       throw new FsError("EIO");
      })(),
      stdout: { async write(bytes) { stdout.push(...bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
     });
     assert.equal(result.exitCode, 1);
     assert.deepEqual(stdout, [112, serial ? 9 : separator, 113, ...(split ? [114] : []), separator]);
     assert.ok(stderr.includes("EIO"), stderr);
     assert.equal(stderr.split("EIO").length - 1, 1);
    });
   }
  }
 }
}
