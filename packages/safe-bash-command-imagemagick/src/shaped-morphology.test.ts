import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-31 dilation of a centered white point on black.
const cases = [
    ["Cross:2", "........./........./..#...#../...#.#.../....#..../...#.#.../..#...#../........./........."],
    ["Plus:2", "........./........./....#..../....#..../..#####../....#..../....#..../........./........."],
    ["Square:2", "........./........./..#####../..#####../..#####../..#####../..#####../........./........."],
    ["Octagon:1", ".#./###/.#."],
    ["Diamond:1", ".#./###/.#."],
    ["Plus:1", ".#./###/.#."],
    ["Octagon:2", "......./..###../.#####./.#####./.#####./..###../......."],
    ["Octagon:3", "..###../.#####./#######/#######/#######/.#####./..###.."],
    ["Diamond:3", "...#.../..###../.#####./#######/.#####./..###../...#..."],
    ["Plus:3", "...#.../...#.../...#.../#######/...#.../...#.../...#..."],
    ["Octagon", "......./..###../.#####./.#####./.#####./..###../......."],
    ["Diamond", "......./......./...#.../..###../...#.../......./......."],
    ["Plus", "......./...#.../...#.../.#####./...#.../...#.../......."],
    ["Octagon:0", "......./..###../.#####./.#####./.#####./..###../......."],
    ["Diamond:0", "......./......./...#.../..###../...#.../......./......."],
    ["Plus:0", "......./...#.../...#.../.#####./...#.../...#.../......."],
    ["Octagon:1.5", "......./......./...#.../..###../...#.../......./......."],
    ["Diamond:1.5", "......./......./...#.../..###../...#.../......./......."],
    ["Plus:1.5", "......./......./...#.../..###../...#.../......./......."]
];

it.each(cases.flatMap(([kernel, grid]) => [false, true].map(retained => ({ kernel: kernel!, grid: grid!, retained }))))(
    "matches native $kernel pixels (retained=$retained)", async ({ kernel, grid, retained }) => {
        const size = grid.split("/").length;
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli([
            "-size", `${size}x${size}`, "xc:black", "-fill", "white", "-draw", `point ${Math.floor(size / 2)},${Math.floor(size / 2)}`,
            "-morphology", "Dilate", kernel, "out.png"
        ], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([size, size]);
        expect([...output.data]).toEqual([...grid.split("/").join("")].flatMap(pixel =>
            pixel === "#" ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    }
);
