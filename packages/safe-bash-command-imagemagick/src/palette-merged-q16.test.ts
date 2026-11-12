import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI averages colors in the same palette cube.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each<{ name: string; greens: number[]; options: string[]; expected: string; depth?: string; info?: boolean }>([
    ...["Palette", "PaletteAlpha"].flatMap(type => [
        { name: `${type} forward`, greens: [20544, 20576], options: ["-type", type], expected: "101050506060".repeat(2) },
        { name: `${type} reversed`, greens: [20576, 20544], options: ["-type", type], expected: "101050506060".repeat(2) },
        { name: `${type} weighted`, greens: [20544, 20544, 20544, 20576], options: ["-type", type], expected: "101050486060".repeat(4) },
        { name: `${type} cycle`, greens: [20544, 20576, 65535], options: ["-type", type, "-cycle", "1"], depth: "8", expected: "ff0000ff0000105060" },
    ]),
    { name: "unique colors control", greens: [20544, 20576], options: ["-unique-colors"], expected: "101050406060101050606060" },
    { name: "colors control", greens: [20544, 20576], options: ["-colors", "256"], expected: "101050506060".repeat(2) },
    { name: "weighted colors control", greens: [20544, 20544, 20544, 20576], options: ["-colors", "256"], expected: "101050486060".repeat(4) },
    { name: "cycle colors control", greens: [20544, 20576, 65535], options: ["-colors", "256", "-cycle", "1"], depth: "8", expected: "ff0000ff0000105060" },
    { name: "distinct count control", greens: [20544, 20576], options: ["-type", "Palette"], info: true, expected: "31" },
])(`${mode}: $name`, async ({ options, greens, expected, depth = "16", info = false }) => {
    const pixels = Buffer.alloc(greens.length * 6);
    greens.forEach((green, index) => {
        const rgb = green === 65535 ? [65535, 0, 0] : [0x1010, green, 0x6060];
        rgb.forEach((value, channel) => pixels.writeUInt16BE(value, index * 6 + channel * 2));
    });
    const input = Buffer.concat([Buffer.from(`P6\n${greens.length} 1\n65535\n`), pixels]);
    const argv = ["/in.ppm", ...options, ...(info ? ["-format", "%k", "info:"] : ["-depth", depth, "-endian", "MSB", "rgb:-"])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.alloc(0);
    expect(output.toString("hex")).toBe(expected);
});
