import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ppm = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
// Parsed native ImageMagick 7.1.2-35 Q16-HDRI output for this fixture.
const paletteStatistics = {
    red: { min: 69, max: 194.095, mean: 147.546, median: 181.875, standardDeviation: 57.5386, kurtosis: -2.06729, skewness: -0.374088, entropy: 1 },
    green: { min: 57.6, max: 203.25, mean: 106.578, median: 64.4762, standardDeviation: 64.8485, kurtosis: -1.84877, skewness: 0.501408, entropy: 1 },
    blue: { min: 58.5714, max: 206.923, mean: 127.508, median: 121.222, standardDeviation: 68.9054, kurtosis: -2.16914, skewness: 0.0754339, entropy: 1 }
};
const constant = (value: number) => ({ min: value, max: value, mean: value, median: value, standardDeviation: 0, kurtosis: 0, skewness: 0, entropy: 0 });

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    async function run(argv: string[]) {
        const fs = new MemoryFileSystem(), files = new Map([["in.ppm", ppm]]);
        await fs.writeFile("/in.ppm", ppm);
        if (argv.includes("white.ppm")) {
            const mask = new Uint8Array([...new TextEncoder().encode("P6\n5 1\n255\n"), ...new Uint8Array(15).fill(255)]);
            files.set("white.ppm", mask);
            await fs.writeFile("/white.ppm", mask);
        }
        let result;
        if (mode !== "public") result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        else {
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const execution = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { exitCode: execution.exitCode, stdout, stderr };
        }
        if (argv.includes("rgb:out.raw")) {
            const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
            expect(Buffer.from(bytes).toString("hex")).toBe("c2403b679079b6cb3f453abcbe3fcf");
            if (argv.includes("json:report.json")) {
                const report = mode === "public" || mode === "retained" ? await fs.readFile("/report.json") : files.get("report.json")!;
                expect(JSON.parse(new TextDecoder().decode(report))).toMatchObject([{ image: { channelStatistics: paletteStatistics } }]);
            }
        }
        return result;
    }

    it(`reports native solid-color type, depth and statistics (${mode})`, async () => {
        const result = await run(["-size", "2x1", "xc:red", "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: {
            geometry: { width: 2, height: 1, x: 0, y: 0 }, colorspace: "sRGB", type: "Palette", depth: 1, pixels: 2,
            channelStatistics: { red: constant(65535), green: constant(0), blue: constant(0) }
        } }]);
    });

    it(`reports fractional quantized palette statistics (${mode})`, async () => {
        const result = await run(["in.ppm", "+dither", "-colors", "5", "-unique-colors", "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: {
            geometry: { width: 5, height: 1, x: 0, y: 0 }, colorspace: "sRGB", type: "Palette", depth: 16, pixels: 5,
            channelStatistics: paletteStatistics
        } }]);
    });

    it(`keeps JSON output working with a stored read mask (${mode})`, async () => {
        const result = await run(["in.ppm", "+dither", "-colors", "5", "-unique-colors", "-read-mask", "white.ppm", "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: { type: "Palette", depth: 16, pixels: 5, channelStatistics: paletteStatistics } }]);
    });

    it(`reports all pixels across stored read boundaries (${mode})`, async () => {
        const result = await run(["-size", "1025x1", "xc:red", "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: {
            type: "Palette", depth: 1, pixels: 1025,
            channelStatistics: { red: constant(65535), green: constant(0), blue: constant(0) }
        } }]);
    });

    it(`uses the lower median and sample deviation for an even palette (${mode})`, async () => {
        const result = await run(["xc:red", "xc:blue", "+append", "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const varying = { min: 0, max: 65535, mean: 32767.5, median: 0, standardDeviation: 46340.2, kurtosis: -2.75, skewness: 0, entropy: 1 };
        expect(JSON.parse(result.stdout)).toMatchObject([{ image: {
            type: "Palette", depth: 1, pixels: 2,
            channelStatistics: { red: varying, green: constant(0), blue: varying }
        } }]);
    });

    it.each([
        { argv: ["xc:red", "-depth", "8"], type: "Palette", depth: 1, channels: { red: constant(255), green: constant(0), blue: constant(0) } },
        { argv: ["xc:red", "-precision", "3"], type: "Palette", depth: 1, channels: { red: constant(65500), green: constant(0), blue: constant(0) } },
        { argv: ["xc:red", "-colorspace", "gray"], type: "Grayscale", depth: 16, channels: { gray: constant(13936.4) } },
        { argv: ["xc:none"], type: "Bilevel", depth: 1, channels: { alpha: constant(0), red: constant(0), green: constant(0), blue: constant(0) } },
        { argv: ["xc:red", "-colorspace", "CMYK"], type: "ColorSeparation", depth: 1, channels: { cyan: constant(0), magenta: constant(65535), yellow: constant(65535), black: constant(0) } }
    ])(`honors depth, precision and channel names for $argv (${mode})`, async ({ argv, type, depth, channels }) => {
        const result = await run([...argv, "json:-"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const image = JSON.parse(result.stdout)[0].image;
        expect(image).toMatchObject({ type, depth, pixels: 1 });
        expect(image.channelStatistics).toEqual(channels);
    });

    it.each([false, true])(`keeps palette RGB bytes (intermediate JSON=%s, ${mode})`, async intermediate => {
        const result = await run(["in.ppm", "+dither", "-colors", "5", "-unique-colors", ...(intermediate ? ["-write", "json:report.json"] : []), "-depth", "8", "rgb:out.raw"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
    });
}
