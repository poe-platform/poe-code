import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 inputs: 4x3 on 12x10+3+4 and 3x2 on 12x10+7+2.
const a = readFileSync(new URL("./fixtures/layers-merge-a.png", import.meta.url));
const b = readFileSync(new URL("./fixtures/layers-merge-b.png", import.meta.url));
const pixels = [decodeImage(a), decodeImage(b)];
const cases = [
    { name: "positioned layers", args: ["/a.png", "/b.png"], size: [7, 5], page: [12, 10, 3, 2], layers: [[0, 0, 2], [1, 4, 0]] },
    { name: "reversed layers", args: ["/b.png", "/a.png"], size: [7, 5], page: [12, 10, 3, 2], layers: [[1, 4, 0], [0, 0, 2]] },
    { name: "single layer", args: ["/a.png"], size: [4, 3], page: [12, 10, 3, 4], layers: [[0, 0, 0]] },
    { name: "reset pages", args: ["/a.png", "/b.png", "+repage"], size: [4, 3], page: [4, 3, 0, 0], layers: [[0, 0, 0], [1, 0, 0]] },
    { name: "negative offsets", args: ["/a.png", "-repage", "12x10-2-3", "(", "/b.png", "-repage", "20x20+1+0", ")"], size: [6, 5], page: [12, 10, -2, -3], layers: [[0, 0, 0], [1, 3, 3]] },
    { name: "overlapping layers", args: ["/a.png", "(", "/b.png", "-repage", "12x10+4+5", ")"], size: [4, 3], page: [12, 10, 3, 4], layers: [[0, 0, 0], [1, 1, 1]] },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`${mode} merges $name without losing placement or page geometry`, async ({ args, size, page, layers }) => {
        const files = new Map<string, Uint8Array>([["/a.png", a], ["/b.png", b]]);
        const fs = createMemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = [...args, "-background", "none", "-layers", "Merge", "PNG32:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual(size);
        const [width, height, x, y] = page;
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width, height, x, y });
        const expected = new Uint8Array(size[0]! * size[1]! * 4);
        for (const [index, left, top] of layers) {
            const input = pixels[index!]!;
            for (let row = 0; row < input.height; row++) {
                expected.set(input.data.subarray(row * input.width * 4, (row + 1) * input.width * 4), ((top! + row) * size[0]! + left!) * 4);
            }
        }
        expect(output.data).toEqual(expected);
    });
}
