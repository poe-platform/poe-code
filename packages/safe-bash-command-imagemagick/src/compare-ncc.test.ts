import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const gradient = [[16, 32, 64], [54, 70, 99], [93, 109, 134], [131, 147, 170], [170, 186, 205], [208, 224, 240]];
const altered = [[19, 34, 65], [59, 74, 102], [100, 115, 139], [142, 155, 174], [183, 196, 210], [226, 235, 244]];

// Golden metrics from ImageMagick 7.1.2 Q16-HDRI on these exact RGB bytes.
for (const retained of [false, true]) {
    for (const [name, rowsA, rowsB, expected, exitCode] of [
        ["identical gradient", gradient, gradient, "0 (0)", 0],
        ["altered gradient", gradient, altered, "10.7627 (0.000164228)", 1],
        ["alpha gradient", gradient.map((row, i) => [...row, [255, 128, 0, 64, 192, 255][i]!]), altered.map((row, i) => [...row, [240, 135, 0, 75, 180, 250][i]!]), "89.4889 (0.00136551)", 1],
        ["reversed gradient", gradient, [...gradient].reverse(), "65535 (1)", 1],
        ["different solids", [[255, 0, 0]], [[0, 0, 255]], "32767.5 (0.5)", 1],
        ["identical solids", [[255, 0, 0]], [[255, 0, 0]], "32767.5 (0.5)", 0]
    ] as const) {
        it(`reports NCC distortion for ${name}, retained=${retained}`, async () => {
            const images = await Promise.all([rowsA, rowsB].map(rows =>
                sharp(Uint8Array.from(rows.flatMap(row => Array.from({ length: 8 }, () => row).flat())), { raw: { width: 8, height: rows.length, channels: rows[0]!.length as 3 | 4 } }).png().toBuffer()));
            const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files)
                await filesystem.writeFile(`/${name}`, bytes);
            const result = await runCompareCli(["-metric", "NCC", "a.png", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(exitCode);
            expect(result.stderr).toBe(`${expected}\n`);
        });
    }
}
