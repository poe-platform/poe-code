import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
it.each([
    { operators: ["-equalize", "-equalize"], expected: [0, 85, 85, 255, 170, 255, 255, 255, 85, 170, 255, 255] },
    { operators: ["-equalize"], expected: [0, 85, 85, 255, 170, 255, 255, 255, 85, 170, 255, 255] },
    { operators: ["-channel", "RGB", "-equalize", "+channel"], expected: [85, 85, 85, 128, 255, 255, 255, 224, 170, 170, 170, 160] }
])(`equalizes original 16-bit PNG samples (retained=${retained}): $operators`, async ({ operators, expected }) => {
    // Native ImageMagick 7.1.2: -size 3x1 xc:#20406080 -fill '#808080c0'
    // -draw 'point 1,0' -fill '#e0c0a040' -draw 'point 2,0' -strip png:-
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAYAAABLcMj3AAAAIklEQVQI12NUUHBwSEhoaAjab64lPTXh/++sP+7/lQ8wAgByuAqOOvnl1gAAAABJRU5ErkJggg==", "base64");
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    expect(await runConvertCli(["input.png", ...operators, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
});
