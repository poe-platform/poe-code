import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem } from "./helpers.js";

for (const tool of ["sed", "awk"] as const) {
  for (const blocked of ["stdin", "stdout", "stderr", "loop"] as const) {
    test(`${tool} cancels blocked ${blocked} without waiting for host cooperation`, { timeout: 2000 }, async () => {
      const controller = new AbortController();
      const fs = await makeFileSystem();
      const command = createTextProgramCommands({ maxSteps: 1_000_000_000 }).find(definition => definition.name === tool)!;
      const never = () => new Promise<void>(() => {});
      const source: ByteSource = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) }; } };
      const args = blocked === "stderr" ? ["--unsupported"] : blocked === "loop" ? [tool === "sed" ? ":repeat;b repeat" : "BEGIN { while(1) value++ }"] : [tool === "sed" ? "p" : "{print}"];
      const reason = new Error("oracle cancellation");
      const timer = setTimeout(() => controller.abort(reason), 10);
      try {
        await assert.rejects(async () => command.execute({
          command: tool, args, cwd: "/work", fs, env: {}, signal: controller.signal,
          stdin: blocked === "stdin" ? source : toByteSource("line\n"),
          stdout: { write: blocked === "stdout" ? never : async () => {} },
          stderr: { write: blocked === "stderr" ? never : async () => {} },
        }), error => error === reason);
      } finally { clearTimeout(timer); }
    });
  }
}
