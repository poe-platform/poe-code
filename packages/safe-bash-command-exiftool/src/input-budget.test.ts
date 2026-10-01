import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createExiftoolCommands, type ExiftoolCommandsOptions } from "./index.js";
import { fixture } from "../tests/fixtures.js";

for (const source of ["file", "stream", "stdin", "combined", "argfile"] as const) {
  for (const exact of [false, true]) {
    test(`ExifTool ${source} respects cumulative caller input budget (${exact ? "exact" : "exceeded"})`, async () => {
      const fs = createMemoryFileSystem();
      const png = fixture("title");
      await fs.writeFile("/image.png", png);
      const argfile = new TextEncoder().encode("-Title\nimage.png\n");
      await fs.writeFile("/args", argfile);
      if (source === "file") Object.defineProperty(fs, "readStream", { value: undefined });
      const total = png.length * (source === "combined" ? 2 : 1) + (source === "argfile" ? argfile.length : 0);
      const failure = Object.assign(new Error("caller input ceiling exceeded"), { name: "BudgetExceededError" });
      const checks: number[] = [];
      const options: ExiftoolCommandsOptions = {};
      const command = createExiftoolCommands(options)[0]!;
      const args = source === "argfile" ? ["-@", "args"] : ["-Title", ...(source === "combined" ? ["image.png", "-"] : [source === "stdin" ? "-" : "image.png"])];
      const context: CommandContext = {
        command: command.name, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () { yield png.subarray(0, 8); yield png.subarray(8); })(),
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
        signal: new AbortController().signal,
        inputBudget: { maxBytes: exact ? total : total - 1, check(bytes) {
          checks.push(bytes);
          if (bytes > (exact ? total : total - 1)) throw failure;
        } },
      };
      if (exact) assert.equal((await command.execute(context)).exitCode, 0);
      else await assert.rejects(async () => command.execute(context), (error: unknown) => error === failure);
      assert.equal(checks.at(-1), total);
    });
  }
}
