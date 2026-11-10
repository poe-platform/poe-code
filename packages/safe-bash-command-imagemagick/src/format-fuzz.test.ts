import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const target of ["info:", "info:out"]) {
    it.each([
      { options: ["-fuzz", "20%"], value: "20%" },
      { options: ["-fuzz", "20%", "-fuzz", "0%"], value: "0%" },
      { options: ["-fuzz", "20%", "-fuzz", "0%", "+fuzz"], value: "0" },
      { options: ["+fuzz"], value: "0" },
      { options: ["-fuzz", "3276.75"], value: "3276.75" },
      { options: ["-fuzz", "01.50%"], value: "01.50%" },
      { options: [], value: undefined }
    ])(`formats the active fuzz value (${mode}, ${target}): $options`, async ({ options, value }) => {
      const fs = new MemoryFileSystem();
      const keep = new TextEncoder().encode("KEEP");
      await fs.writeFile("/out", keep);
      const files = new Map([["out", keep]]);
      const args = ["xc:#2060b080", ...options, "-format", "a:%[fuzz]:b", target];
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      }
      const expected = `a:${value ?? ""}:b`;
      expect(result).toEqual({
        exitCode: 0, stdout: target === "info:" ? expected : "",
        stderr: value === undefined ? "magick: unknown image property '%[fuzz]'\n" : ""
      });
      const output = mode === "sync" || mode === "buffered" ? files.get("out") : await fs.readFile("/out");
      expect(new TextDecoder().decode(output)).toBe(target === "info:" ? "KEEP" : expected);
    });
  }
}
