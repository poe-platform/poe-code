import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI restores these samples after each inverse pair.
const pairs = [
    ["above white", "2 0 0 0 2 0 0 0 2", "0.5 0 0 0 0.5 0 0 0 0.5"],
    ["fractional", "0.5 0 0 0 0.5 0 0 0 0.5", "2 0 0 0 2 0 0 0 2"],
    ["negative", "-1 0 0 0 -1 0 0 0 -1", "-1 0 0 0 -1 0 0 0 -1"],
    ["mixed channels", "0 2 0 0 0 2 2 0 0", "0 0 0.5 0.5 0 0 0 0.5 0"],
    ["alpha", "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2", "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.5"],
    ["offset", "1 0 0 0 0 -0.5 0 1 0 0 0 -0.5 0 0 1 0 0 -0.5 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1", "1 0 0 0 0 0.5 0 1 0 0 0 0.5 0 0 1 0 0 0.5 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1"],
] as const;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16] as const) {
        for (const option of ["-color-matrix", "-recolor"]) {
            it.each(pairs)(`${mode}, depth=${depth}, ${option}: preserves %s intermediate samples`, async (_name, first, second) => {
                const samples = depth === 8 ? [200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200]
                    : [0xc821, 0x1567, 0x3eab, 0x807f, 0x0f01, 0x6303, 0x3305, 65535, 0, 0, 0, 0xc809];
                const pixels = Uint8Array.from(samples, value => depth === 16 ? Math.round(value / 257) : value);
                const input = encodeImage({ width: 3, height: 1, data: pixels,
                    ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}),
                    format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true
                }, { format: "png" }).data;
                const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["/in.png", option, first, option, second, "-depth", String(depth), `${depth === 16 ? "PNG64" : "PNG32"}:/out.png`];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
                expect(output[24]).toBe(depth);
                const decoded = decodeImage(output);
                expect([...(depth === 16 ? decoded.data16! : decoded.data)]).toEqual(samples);
            });
        }
    }
}
