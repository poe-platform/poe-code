import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 7x5 grayscale pixels numbered 1 through 35.
// Each axis lists [offset, length] for its two tiles, in output order.
const near = [[0, 4], [4, 3]] as const;
const middle = [[0, 5], [3, 4]] as const;
const far = [[0, 6], [1, 6]] as const;
const top = [[0, 3], [3, 2]] as const;
const center = [[0, 3], [2, 3]] as const;
const bottom = [[0, 4], [1, 4]] as const;
const input = Uint8Array.from([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        [[], near, top],
        [["-gravity", "northwest"], near, top],
        [["-gravity", "north"], middle, top],
        [["-gravity", "northeast"], far, top],
        [["-gravity", "west"], near, center],
        [["-gravity", "center"], middle, center],
        [["-gravity", "east"], far, center],
        [["-gravity", "southwest"], near, bottom],
        [["-gravity", "south"], middle, bottom],
        [["-gravity", "southeast"], far, bottom],
        [["-gravity", "southeast", "+gravity"], near, top],
    ] as const)(`preserves grid crop pixels, order and page with %j (${mode})`, async (options, columns, rows) => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", ...options, "-crop", "2x2@", "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const stored = mode === "command" || mode === "retained";
        const names = stored ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
        expect(names.filter(name => name.startsWith("tile-")).sort()).toEqual(["tile-00.png", "tile-01.png", "tile-02.png", "tile-03.png"]);
        let index = 0;
        for (const [y, height] of rows) for (const [x, width] of columns) {
            const filename = `/tile-${String(index++).padStart(2, "0")}.png`;
            const actual = decodeImage(stored ? await filesystem.readFile(filename) : files.get(filename)!);
            expect([actual.width, actual.height]).toEqual([width, height]);
            expect(actual.virtualCanvas).toEqual({ width: 7, height: 5, x, y });
            const expectedPixels = [];
            for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
                const sample = 1 + row * 7 + column;
                expectedPixels.push(sample, sample, sample, 255);
            }
            expect(actual.data).toEqual(Uint8Array.from(expectedPixels));
        }
    });
}
