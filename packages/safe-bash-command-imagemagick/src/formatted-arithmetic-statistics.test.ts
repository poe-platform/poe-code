import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

for (const width of [512, 513, 2049]) {
  it.each([[], ["-evaluate", "Add", "0"], ["-gamma", "1"]])(
    `formats red-channel statistics after arithmetic at ${width} pixels (%j)`, async (...operation) => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
      const command = createMagickCommand();
      const argumentValues = createCommandArguments([
        "-size", `${width}x1`, "xc:#3388ab", ...operation,
        "-format", "%wx%h %[fx:mean.r]", "info:out"
      ]);
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe(`${width}x1 0.2`);
    }
  );
}
