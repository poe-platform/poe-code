import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI treats these names as user variables, not channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const operation of ["fx", "format"] as const) {
    it.each([
      { expression: "alpha", valid: false },
      { expression: "opacity", valid: false },
      { expression: "u.alpha", valid: false },
      { expression: "u.opacity", valid: false },
      { expression: "alpha=0.5;alpha", valid: true },
      { expression: "opacity=0.5;opacity", valid: true },
      { expression: "a", valid: true }
    ])(`${mode}: ${operation} $expression`, async ({ expression, valid }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = [expression === "a" ? "xc:#12345680" : "xc:#123456", ...(operation === "fx"
        ? ["-fx", expression, "-depth", "8", "rgb:/out"]
        : ["-format", `%[fx:${expression}]`, "info:/out"])];
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      const output = "stdout" in result ? result : { ...result, stdout, stderr };
      expect(output.exitCode, output.stderr).toBe(valid ? 0 : 1);
      expect(output.stdout).toBe("");
      expect(output.stderr).toEqual(valid ? "" : expect.stringContaining(expression.split(".").at(-1)!));
      const bytes = mode === "command" || mode === "retained"
        ? await fs.readFile("/out").catch(error => { expect(error.code).toBe("ENOENT"); return undefined; })
        : files.get("/out");
      if (!valid && operation === "fx") expect(bytes).toBeUndefined();
      else if (operation === "format") {
        expect(bytes).toBeDefined();
        expect(new TextDecoder().decode(bytes)).toBe(valid ? expression === "a" ? "0.501961" : "0.5" : "");
      }
      else expect(Array.from(bytes!)).toEqual([128, 128, 128]);
    });
  }
}
