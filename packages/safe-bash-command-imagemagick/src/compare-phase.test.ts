import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { compareImageSteps } from "./compare-kernel.js";
import { runCompareCli, runCompareCliSync } from "./index.js";

const gradient = [[0, 20, 40], [60, 80, 100], [120, 140, 160], [180, 200, 220], [240, 100, 50], [30, 70, 110]];
const altered = gradient.map((pixel, i) => i === 4 ? [240, 120, 50] : pixel);
const cases = [
    ["different solids", Array(6).fill([255, 0, 0]), Array(6).fill([0, 0, 255]), "0 (0)", 0],
    ["identical gradient", gradient, gradient, "0 (0)", 0],
    ["changed channel", gradient, altered, "75.1391 (0.00114655)", 1],
    ["reversed gradient", gradient, [...gradient].reverse(), "13652.3 (0.20832)", 1],
    ["alpha gradient", gradient.map((p, i) => [...p, i * 40]), altered.map((p, i) => [...p, 255 - i * 40]), "61509.1 (0.938569)", 1],
    ["unequal dimensions", gradient, altered.slice(0, 3), "33557.1 (0.512048)", 1]
] as const;
const native = spawnSync("magick", ["-version"]);

for (const [name, a, b, expected, status] of cases) {
    it(`compares PHASE ${name} through memory, sync and retained callers`, async () => {
        const images = await Promise.all([a, b].map(pixels => sharp(Uint8Array.from(pixels.flat()), {
            raw: { width: 3, height: pixels.length / 3, channels: pixels[0]!.length as 3 | 4 }
        }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const args = ["-metric", "PHASE", "a.png", "b.png", "null:"];
        const result = await runCompareCli(args, files);
        expect(result.exitCode).toBe(status);
        expect(result.stderr).toBe(`${expected}\n`);
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", "-metric", "PHASE", ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(result.stderr.trim()).toBe(reference.stderr.trim());
            expect(result.exitCode).toBe(reference.status);
        }
        expect(runCompareCliSync(args, files)).toEqual(result);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
    });
}

it("keeps PHASE halo reads bounded and consumes borrowed buffers before reuse", () => {
    const info = { width: 1025, height: 2, hasAlpha: false };
    const steps = compareImageSteps(info, info, { metric: "phase", fuzz: 0, highlightColor: { r: 255, g: 0, b: 0, a: 255 }, composeSrc: false, diff: false });
    const buffer = new Uint8Array(4096);
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(buffer.length);
            for (let i = 0; i < request.length; i++) {
                const position = request.position + i;
                buffer[i] = position % 4 === 3 ? 255 : (position * 37) % 256;
            }
            next = steps.next(buffer.subarray(0, request.length));
        } else next = steps.next();
    }
    expect(next.value).toMatchObject({ metric: "0 (0)", exitCode: 0 });
});
