import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { deskewAngleSteps } from "./deskew.js";
import { createConvertCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

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
