import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs. The threshold straddles
// the original linear red sample and its rounded Q16 representation.
const threshold = ["-channel", "R", "-threshold", "0.3036%", "-separate", "+channel", "-depth", "8", "gray:/out"];
const format = ["-format", "%[fx:r] %[fx:g] %[fx:b]", "info:/out"];
const cases = [
  { name: "zero-size splice", options: ["-colorspace", "RGB", "-background", "none", "-splice", "0x0"], output: threshold, hex: "00" },
  { name: "inserted band", options: ["-colorspace", "RGB", "-background", "none", "-splice", "1x0+1+0"], output: threshold, hex: "0000" },
  { name: "16-bit colorspace round trip", options: ["-colorspace", "RGB", "-background", "none", "-splice", "1x0+1+0", "-colorspace", "sRGB"], output: ["-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "0a0a14141e1effff0000000000000000" },
  { name: "linear working samples", options: ["-colorspace", "RGB", "-background", "none", "-splice", "0x0"], output: format, text: "0.00303527 0.00699541 0.012983" },
  { name: "gray working samples", options: ["-colorspace", "Gray", "-background", "none", "-splice", "0x0"], output: format, text: "0.0729227 0.0729227 0.0729227" },
  { name: "explicit alpha control", options: ["-colorspace", "RGB", "-alpha", "on", "-background", "none", "-splice", "0x0"], output: threshold, hex: "00" },
  { name: "opaque background control", options: ["-colorspace", "RGB", "-background", "white", "-splice", "0x0"], output: threshold, hex: "00" },
  { name: "no splice control", options: ["-colorspace", "RGB", "-background", "none"], output: threshold, hex: "00" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each(cases)(`${mode}: preserves source precision for $name`, async ({ options, output, hex, text }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = ["xc:#0a141e", ...options, ...output];
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
    if (hex !== undefined) expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    else expect(new TextDecoder().decode(bytes)).toBe(text);
  });
}
