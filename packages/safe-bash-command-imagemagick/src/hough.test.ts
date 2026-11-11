import { createHash } from "node:crypto";
import fixtures from "./hough-fixtures.json" with { type: "json" };
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"]) {
    it(`resets animation metadata on rendered Hough frames without changing the source via ${mode}`, async () => {
        const args = ["-size", "3x2", "xc:black", "-set", "delay", "7", "-set", "dispose", "Previous",
            "(", "+clone", "-background", "black", "-hough-lines", "1x1+3", ")", "-format", "%T|%D;", "info:"];
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: "7|Previous;0|Undefined;", stderr: "" });
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([false, true].flatMap(blank => [false, true].map(accumulator => ({ blank, accumulator }))))(`renders native Hough lines via ${mode}, blank=$blank accumulator=$accumulator`, async ({ blank, accumulator: includeAccumulator }) => {
        const pixels = new Uint8Array(32 * 24 * 4);
        for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
            const i = (y * 32 + x) * 4;
            const white = !blank && (y === 5 && x >= 2 && x <= 29 || (y === 10 || y === 19) && x >= 8 && x <= 21 || (x === 8 || x === 21) && y >= 10 && y <= 19);
            pixels.fill(white ? 255 : 0, i, i + 3); pixels[i + 3] = 255;
        }
        const input = await sharp(pixels, { raw: { width: 32, height: 24, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-background", "black", "-stroke", "white", ...(includeAccumulator ? ["-define", "hough-lines:accumulator=true"] : []), "-hough-lines", "5x5+16", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const read = async (name: string) => decodeImage(mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)!);
        const lines = await read(includeAccumulator ? "out-0.png" : "out.png");
        expect([lines.width, lines.height]).toEqual([32, 24]);
        expect([...lines.data]).toEqual(Array.from({ length: 32 * 24 }, (_, i) => {
            const gray = !blank && (Math.floor(i / 32) === 5 || Math.floor(i / 32) === 6) ? 143 : 0;
            return [gray, gray, gray, 255];
        }).flat());
        if (!includeAccumulator) return;
        const accumulator = await read("out-1.png");
        expect([accumulator.width, accumulator.height]).toEqual([180, 45]);
        const peaks = [], alphas = new Set<number>(), grays = new Set<number>();
        for (let i = 0; i < 180 * 45; i++) {
            alphas.add(accumulator.data[i * 4 + 3]!);
            grays.add(accumulator.data[i * 4]!);
            if (accumulator.data[i * 4] === 255) peaks.push([i % 180, Math.floor(i / 180)]);

        }
        expect([...alphas]).toEqual([255]);
        if (blank) expect([...grays]).toEqual([0]);
        expect(peaks).toEqual(blank ? [] : [[90, 16]]);
    });
}

// Native ImageMagick 7.1.2: binary vertical and diagonal lines, 5x5+16.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`matches native angled lines and every vote via ${mode}: $name`, async fixture => {
        const input = Buffer.from(fixture.input, "base64"), files = new Map<string, Uint8Array>([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-background", "black", "-stroke", "white", "-define", "hough-lines:accumulator=true", "-hough-lines", "5x5+16", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const read = async (name: string) => decodeImage(mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)!);
        expect([...(await read("out-0.png")).data]).toEqual([...Buffer.from(fixture.gray, "base64")].flatMap(gray => [gray, gray, gray, 255]));
        expect(createHash("sha256").update((await read("out-1.png")).data).digest("hex")).toBe(fixture.accumulatorSha256);
    });
    it(`honors accumulator reset and processes image sequences via ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "32x24", "xc:white", "xc:black", "-background", "black", "-define", "hough-lines:accumulator=true", "+define", "hough-lines:accumulator", "-hough-lines", "5x5+100", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const name of ["out-0.png", "out-1.png"]) {
            const output = decodeImage(mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)!);
            expect([output.width, output.height]).toEqual([32, 24]);
            expect(new Set(output.data.filter((_, index) => index % 4 !== 3))).toEqual(new Set([0]));
        }
        if (mode === "retained") await expect(filesystem.stat("/out-2.png")).rejects.toMatchObject({ code: "ENOENT" });
        else expect(files.has("out-2.png")).toBe(false);
    });
}

it.each(["bad", "5x5+NaN", "-1x5+16", "5x5+16+2"])("rejects invalid Hough geometry %s without output", geometry => {
    const files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "4x4", "xc:black", "-hough-lines", geometry, "out.png"], files)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Invalid Hough line geometry") });
    expect(files.has("out.png")).toBe(false);
});

it("supports Hough lines through mogrify option parsing", () => {
    const fixture = fixtures[0]!;
    const files = new Map<string, Uint8Array>([["input.png", Buffer.from(fixture.input, "base64")]]);
    expect(runMogrifyCliSync(["-background", "black", "-stroke", "white", "-hough-lines", "5x5+16", "input.png"], files)).toMatchObject({ exitCode: 0 });
    expect([...decodeImage(files.get("input.png")!).data]).toEqual([...Buffer.from(fixture.gray, "base64")].flatMap(gray => [gray, gray, gray, 255]));
});
