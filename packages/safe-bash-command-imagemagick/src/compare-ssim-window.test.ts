import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const native = spawnSync("magick", ["-version"]).error === undefined;

// ImageMagick 7.1.2-35 Q16-HDRI reference values for a localized RGB edit.
for (const retained of [false, true]) {
    for (const [defines, expected] of [
        [[], "6672.26 (0.101812)"],
        [["compare:ssim-radius=1"], "6651.95 (0.101502)"],
        [["compare:ssim-sigma=0.5"], "6640.76 (0.101331)"],
        [["compare:ssim-radius=1", "compare:ssim-sigma=0.5"], "6631.13 (0.101185)"],
        [["compare:ssim-radius=0"], "native"],
        [["compare:ssim-radius=0.5"], "native"],
        [["compare:ssim-radius=2.8", "compare:ssim-sigma=-0.5"], "native"],
        [["compare:ssim-sigma=0"], "native"]
    ] as const) {
        for (const metric of ["SSIM", "DSSIM"]) it.skipIf(expected === "native" && !native)(`${metric} window ${defines.join(",")}, retained=${retained}`, async () => {
            const pixels = Uint8Array.from(Array.from({ length: 120 }, (_, i) => {
                const x = i % 12, y = Math.floor(i / 12);
                return [(x * 37 + y * 13) % 256, (y * 29 + x * 3) % 256, (x * 19 + y * 41) % 256];
            }).flat());
            const a = await sharp(pixels, { raw: { width: 12, height: 10, channels: 3 } }).png().toBuffer();
            for (let y = 3; y < 7; y++) for (let x = 4; x < 8; x++) pixels.set([233, 15, 110], (y * 12 + x) * 3);
            const b = await sharp(pixels, { raw: { width: 12, height: 10, channels: 3 } }).png().toBuffer();
            const files = new Map([["a.png", a], ["b.png", b]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", metric, ...defines.flatMap(value => ["-define", value]), "a.png", "b.png", "null:"];
            const reference = native ? spawnSync("magick", ["compare", ...args.slice(0, -3),
                ...[a, b].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" }) : undefined;
            if (reference) expect(reference.status).toBe(1);
            const stderr = expected === "native" ? reference!.stderr.trim() : expected;
            if (reference) expect(reference.stderr.trim()).toBe(stderr);
            expect(await runCompareCli(args, retained ? { filesystem, cwd: "/" } : files))
                .toEqual({ exitCode: 1, stdout: "", stderr: `${stderr}\n` });
        });
    }
}

for (const radius of [1, 6, 16]) it(`keeps radius ${radius} windows within bounded borrowed reads`, async () => {
    const { compareImageSteps } = await import("./compare-kernel.js");
    const image = { width: 1030, height: 1, hasAlpha: false };
    const steps = compareImageSteps(image, image, {
        metric: "ssim", ssimRadius: radius, fuzz: 0,
        highlightColor: { r: 255, g: 0, b: 0, a: 255 }, composeSrc: false, diff: false
    });
    const buffer = new Uint8Array(4096);
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(buffer.length);
            for (let i = 0; i < request.length; i++) buffer[i] = (request.position + i) % 256;
            next = steps.next(buffer.subarray(0, request.length));
        } else next = steps.next();
    }
    expect(next.value.metric).toBe("0 (0)");
    expect(next.value.exitCode).toBe(0);
});
