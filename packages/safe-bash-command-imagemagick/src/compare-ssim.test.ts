import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";
import { compareImageSteps } from "./compare-kernel.js";

// Eight-bit gradient and modulated gradient; ImageMagick 7.1.2 Q16-HDRI
// reports 106.146 (0.00161969) for these exact pixel values.
const rowsA = [[16, 32, 64], [54, 70, 99], [93, 109, 134], [131, 147, 170], [170, 186, 205], [208, 224, 240]];
const rowsB = [[19, 34, 65], [59, 74, 102], [100, 115, 139], [142, 155, 174], [183, 196, 210], [226, 235, 244]];

for (const retained of [false, true]) {
    for (const identical of [false, true]) {
        it(`reports SSIM distortion, retained=${retained}, identical=${identical}`, async () => {
            const images = await Promise.all([rowsA, identical ? rowsA : rowsB].map(rows =>
                sharp(Uint8Array.from(rows.flatMap(row => Array.from({ length: 8 }, () => row).flat())), { raw: { width: 8, height: 6, channels: 3 } }).png().toBuffer()));
            const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files)
                await filesystem.writeFile(`/${name}`, bytes);
            const result = await runCompareCli(["-metric", "SSIM", "a.png", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(identical ? 0 : 1);
            expect(result.stderr).toBe(identical ? "0 (0)\n" : "106.146 (0.00161969)\n");
        });
    }
}

it("preserves SSIM windows across bounded reads with borrowed buffers", () => {
    const image = { width: 1025, height: 2, hasAlpha: false };
    const steps = compareImageSteps(image, image, { metric: "ssim", fuzz: 0, highlightColor: { r: 255, g: 0, b: 0, a: 255 }, composeSrc: false, diff: false });
    const buffer = new Uint8Array(4096);
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(buffer.length);
            for (let i = 0; i < request.length; i++) {
                const position = request.position + i, channel = position % 4;
                const pixel = Math.floor(position / 4), x = pixel % image.width, y = Math.floor(pixel / image.width);
                buffer[i] = channel === 3 ? 255 : (x * 17 + y * 31 + channel * 73 + request.image * (x >= 1012 ? 19 : 0)) % 256;
            }
            next = steps.next(buffer.subarray(0, request.length));
        }
        else
            next = steps.next();
    }
    // ImageMagick 7.1.2 on the same RGB pattern, changed across a chunk boundary.
    expect(next.value.metric).toBe("167.683 (0.00255868)");
    expect(next.value.exitCode).toBe(1);
});
