import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { deskewAngleSteps } from "./deskew.js";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable).each(["buffered", "retained", "sync"])("deskews the sticker with native geometry and pixels (%s)", async mode => {
    const fixture = readFileSync(new URL("./fixtures/sticker.png", import.meta.url));
    const input = spawnSync("magick", ["-", "-resize", "64x64", "png:-"], { input: fixture }).stdout;
    const args = ["input.png", "-deskew", "40%", "png:-"];
    const files = new Map([["input.png", new Uint8Array(input)]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const reference = spawnSync("magick", ["-", "-deskew", "40%", "-depth", "8", "png:-"], { input });
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const actual = decodeImage(result.stdoutBytes!), expected = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(2);
});

for (const width of [123, 128])
for (const slope of [-0.0625, 0, 0.0625]) {
    const height = 64, data = new Uint8Array(width * height * 4).fill(255);
    for (let x = 8; x < width - 8; x++) for (const baseline of [16, 32, 48]) {
        const y = baseline + Math.round(slope * x);
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
    it(`detects text line skew ${slope}, width ${width} without native tools`, () => {
        const steps = deskewAngleSteps({ width, height, data }, "40%");
        let next = steps.next();
        while (!next.done) next = steps.next();
        expect(next.value).toBeCloseTo(-Math.atan(slope), 2);
    });
    it.skipIf(!nativeAvailable).each(["40%", "26214"])(`public command matches native for slope ${slope}, width ${width}, threshold %s`, async threshold => {
        const input = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["/input.png", "-background", "#5588bb", "-deskew", threshold, "/output.png"];
        const result = await createConvertCommand().execute({
            command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        const reference = spawnSync("magick", ["-", ...args.slice(1, -1), "-depth", "8", "png:-"], { input });
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const actual = decodeImage(await fs.readFile("/output.png")), expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(2);
    });
}

it("applies deskew through mogrify and rejects invalid thresholds", async () => {
    const files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "8x8", "xc:white", "input.png"], files).exitCode).toBe(0);
    expect((await runMogrifyCli(["-deskew", "40%", "input.png"], files)).exitCode).toBe(0);
    const image = decodeImage(files.get("input.png")!);
    expect([image.width, image.height]).toEqual([10, 10]);
    for (const backend of [files, { filesystem: new MemoryFileSystem(), cwd: "/" }]) {
        expect((await runConvertCli(["xc:white", "-deskew", "invalid", "png:-"], backend)).exitCode).not.toBe(0);
    }
});

for (const slope of [-0.0625, 0, 0.0625]) {
    it.each(["buffered", "retained", "sync"])(`exposes deskew:angle for slope ${slope} (%s)`, async mode => {
        const width = 128, height = 64, data = new Uint8Array(width * height * 4).fill(255);
        for (let x = 8; x < width - 8; x++) for (const baseline of [16, 32, 48]) {
            const y = baseline + Math.round(slope * x);
            data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
        }
        const input = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-set", "label", "preserved", "-deskew", "40%", "-format", "%[deskew:angle]|%[label]", "info:"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const degrees = -Math.atan(slope) * 180 / Math.PI;
        expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: `${slope === 0 ? "-0" : degrees.toPrecision(17)}|preserved` });
        if (nativeAvailable) {
            const reference = spawnSync("magick", ["-", ...args.slice(1)], { input });
            expect(reference.status, reference.stderr.toString()).toBe(0);
            expect(result.stdout.trim()).toBe(reference.stdout.toString());
        }
    });
}

it.skipIf(!nativeAvailable).each(["buffered", "retained", "sync"])("honors deskew auto-crop values and reset (%s)", async mode => {
    const input = spawnSync("magick", ["-size", "96x48", "xc:white", "+antialias", "-fill", "black", "-stroke", "none", "-draw", "polygon 8,8 80,12 80,15 8,11", "-draw", "polygon 8,18 80,22 80,25 8,21", "-draw", "polygon 8,28 80,32 80,35 8,31", "PNG24:-"]).stdout;
    for (const value of [undefined, "0", "1", "2", "3", "4", "true", "false", "reset"]) {
        const define = value === undefined ? [] : value === "reset" ? ["-define", "deskew:auto-crop=1", "+define", "deskew:auto-crop"] : ["-define", `deskew:auto-crop=${value}`];
        const args = ["/input.png", ...define, "-deskew", "40%", "png:-"];
        const files = new Map([["/input.png", new Uint8Array(input)]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const reference = spawnSync("magick", ["-", ...args.slice(1, -1), "-depth", "8", "png:-"], { input });
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const actual = decodeImage(result.stdoutBytes!), expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height, actual.virtualCanvas], String(value)).toEqual([expected.width, expected.height, expected.virtualCanvas]);
        expect(Math.max(...actual.data.map((v, i) => Math.abs(v - expected.data[i]!))), String(value)).toBeLessThanOrEqual(2);
    }
});

it.each(["buffered", "retained", "sync", "mogrify", "public"])("clips deskew auto-crop to the rotated raster for edge-reaching stripes (%s)", async mode => {
    const input = readFileSync(new URL("./fixtures/deskew-edge-stripes.png", import.meta.url));
    // ImageMagick 7.1.2: 67x32 pixels on page 68x39+0+1.
    const expected = decodeImage(readFileSync(new URL("./fixtures/deskew-edge-stripes-cropped.png", import.meta.url)));
    const files = new Map([["/input.png", new Uint8Array(input)]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const options = ["-define", "deskew:auto-crop=1", "-deskew", "40%"];
    const args = ["/input.png", ...options, "PNG32:-"];
    let output: Uint8Array;
    if (mode === "public") {
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["/input.png", ...options, "PNG32:/output.png"]).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        output = await filesystem.readFile("/output.png");
    } else {
        const result = mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], files) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        output = mode === "mogrify" ? files.get("/input.png")! : result.stdoutBytes!;
    }
    const actual = decodeImage(output);
    expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([67, 32, { width: 68, height: 39, x: 0, y: 1 }]);
    expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(2);
});

// Fixed geometry keeps this regression active when native ImageMagick is absent.
it.each(["buffered", "retained", "sync", "mogrify", "public"])("auto-crops without changing the rotated pixels (%s)", async mode => {
    const width = 32, height = 24, data = new Uint8Array(width * height * 4).fill(255);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 24; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    const input = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const options = ["-define", "deskew:auto-crop=1", "-deskew", "0"];
    const args = ["/input.png", ...options, "png:-"];
    let output: Uint8Array;
    if (mode === "public") {
        const result = await createConvertCommand().execute({
            command: "convert", args: createCommandArguments(["/input.png", ...options, "/output.png"]).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        output = await filesystem.readFile("/output.png");
    } else {
        const result = mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], files) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        output = mode === "mogrify" ? files.get("/input.png")! : result.stdoutBytes!;
    }
    const actual = decodeImage(output);
    expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([16, 8, { width: 34, height: 26, x: 9, y: 9 }]);
    const uncropped = runConvertCliSync(["/input.png", "-deskew", "0", "png:-"], new Map([["/input.png", input]]));
    const rotated = decodeImage(uncropped.stdoutBytes!);
    for (let y = 0; y < 8; y++) expect(actual.data.subarray(y * 16 * 4, (y + 1) * 16 * 4)).toEqual(rotated.data.subarray(((y + 10) * 34 + 10) * 4, ((y + 10) * 34 + 26) * 4));
});
