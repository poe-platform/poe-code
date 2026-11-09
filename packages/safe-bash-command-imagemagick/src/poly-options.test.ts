import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded PNG64 samples.
for (const mode of ["sync", "retained"] as const) {
    it.each([
        { args: ["xc:#804020", "xc:#204080", "-poly", "1,1"], expected: [32896, 16448, 8224, 65535] },
        { args: ["xc:#804020", "xc:#204080", "-poly", "1"], expected: [0, 0, 0, 65535] },
        { args: ["xc:#804020", "xc:#204080", "-poly", "0.5 1, 0.5 1,"], expected: [20560, 16448, 20560, 65535] },
        { args: ["xc:#804020", "xc:#204080", "-poly", "1,1,2,1,3,1"], expected: [49344, 49344, 65535, 65535] },
        { args: ["xc:#804020", "xc:#204080", "-poly", "-1,1,1,1"], expected: [0, 0, 24672, 65535] },
        { args: ["xc:#804020", "xc:#204080", "-poly", "0.5,0.5,0.5,2"], expected: [23732, 18480, 19864, 65535] },
        { args: ["/half.png", "/quarter.png", "-poly", "0.5,1,0.5,1"], expected: [20560, 16448, 20560, 24576] },
        { args: ["/half.png", "/quarter.png", "-channel", "R", "-poly", "0.5,1,0.5,1"], expected: [20560, 0, 0, 0] },
        { args: ["xc:#804020", "/quarter.png", "-poly", "0.5,1,0.5,1"], expected: [20560, 16448, 20560, 8192] },
        { args: ["/gray-half.png", "xc:red", "-poly", "0.5,1,0.5,1"], expected: [49152, 0, 0, 65535] },
        { args: ["/gray-half.png", "/gray-quarter.png", "-poly", "0.5,1,0.5,1"], expected: [24576, 24576, 24576, 65535] },
        { args: ["/deep0.png", "/deep1.png", "-poly", "0.5,1,0.5,1"], expected: [10002, 23002, 30003, 40101] },
        { args: ["xc:#010307", "-poly", "0.5,1", "-poly", "2,1"], expected: [257, 771, 1799, 65535] },
        { args: ["xc:#804020", "-poly", "2,1", "-poly", "0.5,1"], expected: [32896, 16448, 8224, 65535] },
        { args: ["xc:#804020", "-poly", "-1,1", "-poly", "-1,1"], expected: [32896, 16448, 8224, 65535] },
        { args: ["-size", "1x1", "xc:#804020", "-size", "3x1", "xc:#204080", "-poly", "0.5,1,0.5,1"], expected: Array(3).fill([20560, 16448, 20560, 65535]).flat(), width: 3 },
    ])(`${mode}: matches native $args`, async ({ args, expected, width = 1 }) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const pixels: Record<string, number[]> = {
            half: [32896, 16448, 8224, 32768], quarter: [8224, 16448, 32896, 16384],
            "gray-half": [32768, 32768, 32768, 65535], "gray-quarter": [16384, 16384, 16384, 65535],
            deep0: [10001, 23002, 30003, 40100], deep1: [10002, 23001, 30003, 40101],
        };
        for (const [name, pixel] of Object.entries(pixels)) {
            if (!args.includes(`/${name}.png`)) continue;
            const gray = name.startsWith("gray");
            const bytes = encodeImage({ width: 1, height: 1, format: "png", space: gray ? "grey16" : "srgb", channels: gray ? 1 : 4,
                density: 72, depth: "ushort", hasAlpha: !gray, data: Uint8Array.from(pixel, value => Math.round(value / 257)), data16: Uint16Array.from(pixel) }, { format: "png" }).data;
            files.set(`/${name}.png`, bytes);
            await fs.writeFile(`/${name}.png`, bytes);
        }
        const argv = [...args, "PNG64:/out.png"];
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, { filesystem: fs, cwd: "/" });
        expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([width, 1]);
        expect([...output.data16!]).toEqual(expected);
    });

    it.each(["", ",", "1,,1", "1x1", "1,foo", "1,1,foo"])(`${mode}: rejects invalid coefficients %s without replacing output`, async value => {
        const previous = new Uint8Array([1, 2, 3]), files = new Map([["/out.png", previous]]), fs = createMemoryFileSystem();
        await fs.writeFile("/out.png", previous);
        const args = ["xc:red", "-poly", value, "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("invalid list of numbers");
        expect(mode === "sync" ? files.get("/out.png") : await fs.readFile("/out.png")).toEqual(previous);
    });
}
