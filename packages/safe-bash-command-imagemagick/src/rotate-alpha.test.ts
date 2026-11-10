import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ffffee00991177245384", "hex")]);
// Native ImageMagick 7.1.2-35 Q16-HDRI, Point/nearest rotation by 37 degrees.
const rotated = "204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ffffee00ff00ff00ff204080ff204080ff204080ff204080ff991177ff0000ffff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff204080ff";
const negated = "dfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fff0011ffffff00ffffdfbf7fffdfbf7fffdfbf7fffdfbf7fff66ee88ffffff00ffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fffdfbf7fff";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-background", "#204080", "-rotate", "37"], expected: "srgb  3.0|True" },
        { options: ["-background", "#204080", "-filter", "point", "-interpolate", "nearest", "-rotate", "37"], expected: "srgb  3.0|True" },
        { options: ["-background", "none", "-rotate", "37"], expected: "srgba 4.0|False" },
        { options: ["-background", "#204080", "-rotate", "0"], expected: "srgb  3.0|True" },
        { options: ["-alpha", "on", "-background", "#204080", "-rotate", "37"], expected: "srgba 4.0|True" },
        { options: ["-background", "#204080", "-filter", "point", "-interpolate", "nearest", "-rotate", "37", "-depth", "8"], expected: rotated, raw: true },
        { options: ["-background", "#204080", "-filter", "point", "-interpolate", "nearest", "-rotate", "37", "-negate", "-depth", "8"], expected: negated, raw: true },
    ])(`preserves rotation alpha semantics $options (${mode})`, async ({ options, expected, raw }) => {
        const files = new Map<string, Uint8Array>([["im.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/im.ppm", input);
        const args = ["im.ppm", ...options, ...(raw ? ["rgba:out"] : ["-format", "%[channels]|%[opaque]", "info:out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(raw ? "hex" : "utf8")).toBe(expected);
    });
}
