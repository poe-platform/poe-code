import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  // Native ImageMagick 7.1.2 Q16-HDRI reference results.
  it.each([
    { operation: "Mean", size: "2x1", space: "CMYK", output: ["-format", "%wx%h %[colorspace] %[channels]", "info:/out"], expected: "2x1 CMYK cmyka 5.0" },
    { operation: "Max", size: "2x1", space: "CMYK", output: ["-format", "%wx%h %[colorspace] %[channels]", "info:/out"], expected: "2x1 CMYK cmyka 5.0" },
    { operation: "Mean", size: "1x1", space: "CMYK", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "6d516bb7" },
    { operation: "Mean", size: "2x1", space: "CMYK", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "6d516bb76d516bb7" },
    { operation: "Max", size: "2x1", space: "CMYK", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "203b1ded203b1ded" },
    { operation: "Mean", size: "1x1", space: "sRGB", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "705068b7" },
    { operation: "Mean", size: "2x1", space: "CMYK", first: "xc:cmyka(20%,40%,60%,30%,0.5)", second: "xc:cmyka(60%,20%,10%,50%,0.8)", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "5c6b63a65c6b63a6" },
  ].map(test => ({ first: "xc:#2060b080", second: "xc:#c04020ed", ...test })))(`${mode}: $space $operation $size`, async ({ operation, size, space, first, second, output, expected }) => {
    const fs = createMemoryFileSystem(), files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const args = [first, "-size", size, second, "-colorspace", space, "-evaluate-sequence", operation, ...output];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const bytes = mode === "map" ? files.get("/out")! : await fs.readFile("/out");
    expect(output.at(-1)!.startsWith("info:") ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
  });
}
