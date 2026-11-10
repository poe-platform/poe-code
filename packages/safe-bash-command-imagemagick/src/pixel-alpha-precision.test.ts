import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: pixel text retains the working alpha;
// extracting it as Q16 gray still produces 0x5715.
const cases = [
  { alpha: ["Copy"], text: "srgba(128,80,32,0.340167)" },
  { alpha: ["Shape"], text: "srgba(255,255,255,0.340167)" },
  { alpha: ["Copy", "Activate"], text: "srgba(128,80,32,0.340167)" },
  { alpha: ["On"], text: "srgba(128,80,32,0.501961)" },
  { alpha: ["Copy", "extract"], text: undefined },
  { alpha: ["Shape", "extract"], text: undefined }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each(cases)(`${mode}: preserves alpha precision for $alpha`, async ({ alpha, text }) => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const args = ["xc:#80502080", ...alpha.flatMap(value => ["-alpha", value]),
      ...(text === undefined ? ["-endian", "MSB", "-depth", "16", "gray:/out"]
        : ["-format", "%[pixel:p{0,0}]", "info:/out"])];
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    }
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    if (text === undefined) expect(bytes).toEqual(Uint8Array.of(0x57, 0x15));
    else expect(new TextDecoder().decode(bytes)).toBe(text);
  });
}
