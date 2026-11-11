import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI fills null input with the active background.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { name: "default white", input: ["null:"], pixel: "ffffffff", pixels: 1 },
    { name: "red background", input: ["-background", "red", "null:"], pixel: "ff0000ff", pixels: 1 },
    { name: "transparent background", input: ["-background", "none", "null:"], pixel: "00000000", pixels: 1 },
    { name: "reset background", input: ["-background", "red", "+background", "null:"], pixel: "ffffffff", pixels: 1 },
    { name: "fixed one-pixel size", input: ["-size", "8x4", "null:"], pixel: "ffffffff", pixels: 1 },
    { name: "background captured at input", input: ["-background", "red", "null:", "-background", "blue"], pixel: "ff0000ff", pixels: 1 },
    { name: "default remap palette", input: ["in.ppm", "+dither", "-remap", "null:"], pixel: "ffffffff", pixels: 32 },
    { name: "red remap palette", input: ["in.ppm", "-background", "red", "+dither", "-remap", "null:"], pixel: "ff0000ff", pixels: 32 },
])(`${mode}: null input uses $name`, async ({ input, pixel, pixels }) => {
    for (const report of [false, true]) {
        const ppm = Buffer.concat([Buffer.from("P6\n8 4\n255\n"), Buffer.from(Array.from({ length: 96 }, (_, i) => (13 * i + 9) % 256))]);
        const files = new Map<string, Uint8Array>([["in.ppm", ppm]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", ppm);
        const args = [...input, ...(report ? ["-format", "%[colorspace]|%k", "info:out"] : ["-depth", "8", "rgba:out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(report ? "utf8" : "hex")).toBe(report ? "sRGB|1" : pixel.repeat(pixels));
    }
});
