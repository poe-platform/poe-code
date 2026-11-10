import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: 7x5 grayscale pixels numbered 1 through 35.
const input = Uint8Array.from([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { page: undefined, geometry: "3x2", columns: [[0, 3], [3, 3], [6, 1]], rows: [[0, 2], [2, 2], [4, 1]], warnings: 0, canvas: [7, 5, 0, 0] },
        { page: "11x9+2+1", geometry: "3x2", columns: [[0, 1], [1, 3], [4, 3]], rows: [[0, 1]], warnings: 1, canvas: [11, 9, 2, 1] },
        { page: "11x9+2+1", geometry: "3x2+0+0", columns: [[0, 1]], rows: [[0, 1]], warnings: 0, canvas: [11, 9, 2, 1] },
        { page: "9x9+2+1", geometry: "3x2", columns: [[0, 1], [1, 3], [4, 3]], rows: [[0, 1], [1, 2], [3, 2]], warnings: 1, canvas: [9, 9, 2, 1] },
        { page: "11x9+2+1", geometry: "7x5", columns: [[0, 7]], rows: [[0, 5]], warnings: 0, canvas: [11, 9, 2, 1] },
        { page: "9x9+2+1", geometry: "0x2", columns: [[0, 7]], rows: [[0, 1], [1, 2], [3, 2]], warnings: 1, canvas: [9, 9, 2, 1] },
        { page: "6x4+2+1", geometry: "3x2", columns: [[0, 1], [1, 3]], rows: [[0, 1], [1, 2]], warnings: 0, canvas: [6, 4, 2, 1] },
    ] as const)(`anchors $geometry tiles to page $page (${mode})`, async ({ page, geometry, columns, rows, warnings, canvas }) => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", ...(page ? ["-repage", page] : []), "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(`magick: geometry does not contain image '${geometry}'\n`.repeat(warnings));
        const stored = mode === "command" || mode === "retained";
        const names = stored ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
        expect(names.filter(name => name.startsWith("tile-")).sort()).toEqual(
            Array.from({ length: columns.length * rows.length }, (_, i) => `tile-${String(i).padStart(2, "0")}.png`));
        let index = 0;
        for (const [top, height] of rows) for (const [left, width] of columns) {
            const filename = `/tile-${String(index++).padStart(2, "0")}.png`;
            const actual = decodeImage(stored ? await filesystem.readFile(filename) : files.get(filename)!);
            expect([actual.width, actual.height]).toEqual([width, height]);
            expect(actual.virtualCanvas).toEqual({ width: canvas[0], height: canvas[1], x: canvas[2] + left, y: canvas[3] + top });
            const pixels = [];
            for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
                const value = 1 + y * 7 + x;
                pixels.push(value, value, value, 255);
            }
            expect(actual.data).toEqual(Uint8Array.from(pixels));
        }
    });
}
