import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const cases = [
  { edits: ["-set", "type", "Grayscale", "+set", "type"], output: "Grayscale|DirectClass sRGB ;" },
  { edits: ["-set", "type", "TrueColor"], output: "Palette|DirectClass sRGB ;" },
  { edits: ["-set", "type", "marker"], output: "Palette|DirectClass sRGB ;" },
  { edits: ["-set", "type", "Grayscale"], output: "Grayscale|DirectClass sRGB ;" },
  { edits: ["-set", "TyPe", "gRaYsCaLe"], output: "Grayscale|DirectClass sRGB ;" },
  { edits: ["-set", "type", "Grayscale", "-set", "type", "marker"], output: "Grayscale|DirectClass sRGB ;" },
  { edits: ["-set", "type", "Grayscale", "-set", "type", "TrueColor"], output: "Palette|DirectClass sRGB ;" },
  { edits: ["-set", "type", "Grayscale"], output: [0x73, 0x88, 0x9a] },
  { edits: ["-type", "Grayscale"], output: [0x85, 0x85, 0x85] },
];

for (const mode of ["buffered", "retained", "command"]) {
  for (const { edits, output } of cases) {
    it(`${mode}: ${edits.join(" ")} to ${typeof output === "string" ? "info" : "rgb"}`, async () => {
      const initial = new TextEncoder().encode("KEEP");
      const fs = new MemoryFileSystem();
      await fs.writeFile("/out", initial);
      const files = new Map([["/out", initial]]);
      const args = ["xc:#73889a", ...edits, ...(typeof output === "string"
        ? ["-format", "%[type]|%r;", "info:/out"] : ["-depth", "8", "rgb:/out"])];
      if (mode === "command") {
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += chunk; } }
        });
        expect(result).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
      } else {
        expect(await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" }))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const actual = mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
      expect([...actual]).toEqual(typeof output === "string" ? [...new TextEncoder().encode(output)] : output);
    });
  }
}
