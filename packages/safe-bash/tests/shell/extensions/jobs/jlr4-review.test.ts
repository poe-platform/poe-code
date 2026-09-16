import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { agentCommands } from "../../../../src/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { Shell } from "../../../../src/shell/shell.js";

for (const reference of [
  { id: 1, source: '! true & wait "$!"; printf \'wait:%s\\n\' "$?"', sourceHash: "796a2a887563388ef4d24ffc61ff6a52a5f0fb4cfb7b6e946ec4fbe1e14b1f23", stdoutHex: "776169743a300a", waitStatus: 0 },
  { id: 2, source: '! false & wait "$!"; printf \'wait:%s\\n\' "$?"', sourceHash: "ae43695544ebebdf18f630a8da41ebbe01770072b63e3544f05ba0bfec16f397", stdoutHex: "776169743a310a", waitStatus: 1 },
  { id: 3, source: ': && ! true & wait "$!"; printf \'wait:%s\\n\' "$?"', sourceHash: "3082bbdb5ec1cc43917621b7d123e504eb8668752baafa840a2150814ebb5f5d", stdoutHex: "776169743a310a", waitStatus: 1 },
  { id: 4, source: ': && ! false & wait "$!"; printf \'wait:%s\\n\' "$?"', sourceHash: "19e575a8b1407cbca0da9c9daed61eb2f844ad68dfa50df0ed5173b5cf869b0c", stdoutHex: "776169743a300a", waitStatus: 0 },
]) {
    test(`qualified native4 case ${reference.id} wait bytes with adapted EXIT observer`, async context => {
      context.diagnostic(JSON.stringify({
        nativeReceipt: "/private/tmp/jobs53-negation-YOjRP6/handoff.json",
        nativeReceiptSHA256: "cb7a5a94837dfdaed099383de20f5a4688bbf352e853a32da3aed1075e89fc99",
        nativeResultsSHA256: "1203dd6a90bf3e9a903a56c36002243c87977cca534eac9dfe5e0b673489705e",
        classification: "Exact subject source/status/stdout/stderr; EXIT observer is virtual lifecycle instrumentation, not a captured native hook",
      }));
      assert.equal(createHash("sha256").update(reference.source).digest("hex"), reference.sourceHash);
      const exits: number[] = [];
      const observer = (child: boolean): ReturnType<ShellExtension["create"]> => ({
        builtins: [],
        fork: () => observer(true),
        event(event, invocation) {
          if (child && event === "exit") exits.push(invocation.status);
        },
      });
      const shell = new Shell({
        fs: createMemoryFileSystem(),
        extensions: [jobsExtension(), { name: "completion-review", create: () => observer(false) }],
      }).use(agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(reference.source);
      assert.deepEqual({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes), stderr: Buffer.from(result.stderrBytes), exits }, {
        status: 0, stdout: Buffer.from(reference.stdoutHex, "hex"), stderr: Buffer.alloc(0), exits: [reference.waitStatus],
      });
    });
}
