import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rounds page dimensions and truncates offsets.
const pixels = Buffer.from("ff000000ff000000ffffff0000ffffff00ff", "hex");
const cases = [
    { args: ["/in.png", "-repage", "4.6x3.5+1.8+0.6"], width: 5, height: 4, x: 1, y: 0 },
    { args: ["-page", "4.6x3.5+1.8+0.6", "/in.png"], width: 5, height: 4, x: 1, y: 0 },
    { args: ["/in.png", "-page", "4.6x3.5+1.8+0.6"], width: 5, height: 4, x: 1, y: 0 },
    { args: ["/in.png", "-set", "page", "4.6x3.5+1.8+0.6"], width: 5, height: 4, x: 1, y: 0 },
    { args: ["/in.png", "-repage", "7x4+2+1", "-repage", "4x3-1.8-0.4"], width: 4, height: 3, x: -1, y: 0 },
    { args: ["-page", "4x3-1.8-0.4", "/in.png"], width: 4, height: 3, x: -1, y: 0 },
    { args: ["/in.png", "-set", "page", "4x3-1.8-0.4"], width: 4, height: 3, x: -1, y: 0 },
    { args: ["/in.png", "-repage", "5x4+1+0"], width: 5, height: 4, x: 1, y: 0 },
];

for (const mode of ["sync", "command", "buffered", "retained"] as const) {
    for (const flatten of [false, true]) {
        for (const output of ["info", "png"] as const) {
            it.each(cases)(`${mode} ${output}, flatten=${flatten}: $args`, async ({ args, width, height, x, y }) => {
                const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
                const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, data] of files) await fs.writeFile(path, data);
                const argv = [...args, "-background", "black", ...(flatten ? ["-flatten"] : []),
                    ...(output === "info" ? ["-format", "%wx%h|%g", "info:"] : ["PNG32:/out.png"])];
                let stdout = "", stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                if (output === "info") {
                    const offset = flatten ? "+0+0" : `${x >= 0 ? "+" : ""}${x}+${y}`;
                    expect("stdout" in result ? result.stdout : stdout).toBe(`${flatten ? `${width}x${height}` : "3x2"}|${width}x${height}${offset}`);
                    return;
                }
                const decoded = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                expect([decoded.width, decoded.height]).toEqual(flatten ? [width, height] : [3, 2]);
                expect(decoded.virtualCanvas ?? { width: decoded.width, height: decoded.height, x: 0, y: 0 }).toEqual({ width, height, x: flatten ? 0 : x, y: flatten ? 0 : y });
                const original = decodeImage(input).data;
                if (!flatten) {
                    expect(decoded.data).toEqual(original);
                    return;
                }
                const expected = new Uint8Array(width * height * 4);
                for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
                for (let row = 0; row < 2; row++) {
                    for (let column = 0; column < 3; column++) {
                        const dx = column + x, dy = row + y;
                        if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;
                        const source = (row * 3 + column) * 4;
                        expected.set(original.subarray(source, source + 4), (dy * width + dx) * 4);
                    }
                }
                expect(decoded.data).toEqual(expected);
            });
        }
    }
}
