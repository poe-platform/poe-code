import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Expected palette selections from ImageMagick 7.1.2-35 Q16-HDRI.
const paletteColors = [[255, 0, 0, 10], [0, 0, 255, 200]];
const colors = [[0, 0, 255], [255, 0, 0], [0, 255, 0], [100, 140, 200], [230, 190, 40], [180, 50, 120]];
const pixels = [10, 50, 90, 140, 200, 255].flatMap(alpha => colors.flatMap(rgb => [...rgb, alpha]));

for (const mode of ["command", "retained", "buffered", "sync"] as const) for (const depth of [8, 16]) {
    it.each([
        [["+dither"], "000000000000000000100000100111111111"],
        [["-dither", "FloydSteinberg"], "000000000000010100110101101111111111"],
        [["-dither", "Riemersma"], "000000000000000000100000111111111111"],
    ] as const)(`${mode}: depth=${depth} selects translucent palette colors with %j`, async (options, expected) => {
        for (const fixture of [
            { width: 1, height: 1, input: [0, 0, 255, 50], palette: paletteColors.flat(), expected: paletteColors[0]! },
            { width: 1, height: 1, input: [0, 0, 255, 50], palette: [...paletteColors].reverse().flat(), expected: paletteColors[0]! },
            { width: 1, height: 1, input: [0, 0, 255, 50], palette: paletteColors[1]!, expected: paletteColors[1]! },
            { width: 6, height: 6, input: pixels, palette: paletteColors.flat(), expected: [...expected].flatMap(index => paletteColors[Number(index)]!) }
        ]) {
            const input = encodeImage({ width: fixture.width, height: fixture.height,
                data: Uint8Array.from(fixture.input),
                ...(depth === 16 ? { data16: Uint16Array.from(fixture.input, value => value * 257) } : {}),
                format: "png", space: "srgb", channels: 4, hasAlpha: true, depth: depth === 16 ? "ushort" : "uchar", density: 72
            }, { format: "png" }).data;
            const palette = encodeImage({ width: fixture.palette.length / 4, height: 1,
                data: Uint8Array.from(fixture.palette),
                format: "png", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72
            }, { format: "png" }).data;
            const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", ...options, "-remap", "palette.png", depth === 16 ? "PNG64:out.png" : "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            const decoded = decodeImage(output);
            expect(Array.from(decoded.data)).toEqual(fixture.expected);
            if (depth === 16) expect(Array.from(decoded.data16!)).toEqual(fixture.expected.map(value => value * 257));
        }
    });
}
