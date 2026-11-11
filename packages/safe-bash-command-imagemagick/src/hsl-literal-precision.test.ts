import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { name: "HSL canvas", input: "hsl(100,30%,40%)", operations: [], expected: "5c29851e47aeffff" },
    { name: "HSL colorize fill", input: "#4278a280", operations: ["-fill", "hsl(100,30%,40%)", "-colorize", "100"], expected: "5c29851e47ae8080" },
    { name: "HSL tint fill", input: "#4278a280", operations: ["-fill", "hsl(100,30%,40%)", "-tint", "30"], expected: "000028b547608080" },
    { name: "first hue sector", input: "hsl(20,30%,40%)", operations: [], expected: "851e5c2947aeffff" },
    { name: "third hue sector", input: "hsl(140,30%,40%)", operations: [], expected: "47ae851e5c29ffff" },
    { name: "fourth hue sector", input: "hsl(200,30%,40%)", operations: [], expected: "47ae70a3851effff" },
    { name: "fifth hue sector", input: "hsl(260,30%,40%)", operations: [], expected: "5c2947ae851effff" },
    { name: "negative hue", input: "hsl(-40,30%,40%)", operations: [], expected: "851e47ae70a3ffff" },
    { name: "wrapped hue", input: "hsl(460,30%,40%)", operations: [], expected: "5c29851e47aeffff" },
    { name: "achromatic HSL", input: "hsl(100,0%,40%)", operations: [], expected: "666666666666ffff" },
    { name: "fractional alpha", input: "hsla(100,30%,40%,0.25)", operations: [], expected: "5c29851e47ae4000" },
    { name: "hex control", input: "#d65541", operations: [], expected: "d6d655554141ffff" }
  ])(`preserves fractional literal samples (${mode}, $name)`, async ({ input, operations, expected }) => {
    // ImageMagick Q16-HDRI, MSB RGBA16 output.
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = [`xc:${input}`, ...operations, "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/pixel.raw"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
      stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
      : mode === "retained" ? await fs.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
