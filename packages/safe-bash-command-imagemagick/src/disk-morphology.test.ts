import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Pixel grids captured from ImageMagick 7.1.2-31, using an opaque black
// 5x5 image with a single white pixel at (2,2).
const cases = [
    ["Dilate", "Disk:1", "...../..#../.###./..#../....."],
    ["Dilate", "Disk:2", "..#../.###./#####/.###./..#.."],
    ["Dilate", "Disk:1.5", "...../.###./.###./.###./....."],
    ["Dilate", "Square:1", "...../.###./.###./.###./....."],
    ["Erode", "Disk:1", "...../...../...../...../....."],
    ["Open", "Disk:1", "...../...../...../...../....."],
    ["Close", "Disk:1", "...../...../..#../...../....."],
    ["EdgeIn", "Disk:1", "...../...../..#../...../....."],
    ["EdgeOut", "Disk:1", "...../..#../.#.#./..#../....."],
    ["Edge", "Disk:1", "...../..#../.###./..#../....."],
    ["TopHat", "Disk:1", "...../...../..#../...../....."],
    ["BottomHat", "Disk:1", "...../...../...../...../....."]
];

it.each(cases.flatMap(([method, kernel, grid]) => [false, true].map(retained => ({ method: method!, kernel: kernel!, grid: grid!, retained }))))(
    "matches host $method $kernel (retained=$retained)", async ({ method, kernel, grid, retained }) => {
        const pixels = new Uint8Array(5 * 5 * 4);
        for (let i = 0; i < 25; i++) pixels.set([i === 12 ? 255 : 0, i === 12 ? 255 : 0, i === 12 ? 255 : 0, 255], i * 4);
        const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        expect(await runConvertCli(["in.png", "-morphology", method, kernel, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        const expected = [...grid.split("/").join("")].flatMap(pixel => pixel === "#" ? [255, 255, 255] : [0, 0, 0]);
        expect([...output.data].filter((_, i) => i % 4 !== 3)).toEqual(expected);
        if (["Dilate", "Erode", "Open", "Close"].includes(method)) {
            expect([...output.data].filter((_, i) => i % 4 === 3)).toEqual(Array(25).fill(255));
        }
    }
);
