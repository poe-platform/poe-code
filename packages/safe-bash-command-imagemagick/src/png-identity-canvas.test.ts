import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// 4×3 RGB fixture; expected pixels and canvas match ImageMagick 7.1.2-35.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const original = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const flipped = [8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { operations: [], order: original, canvas: [] },
        { operations: ["-repage", "4x3+0+0"], order: original, canvas: [] },
        { operations: ["-flip"], order: flipped, canvas: [] },
        { operations: ["-flop"], order: [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8], canvas: [] },
        { operations: ["-repage", "9x8+2+3", "-flip"], order: flipped, canvas: ["00000009000000080000000200000002"] }
    ])(`only writes nondefault PNG canvases via ${mode}: $operations`, async ({ operations, order, canvas }) => {
        const files = new Map([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const args = ["/in.png", ...operations, "/out.png"];
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([4, 3]);
        expect([...decoded.data]).toEqual(order.flatMap(index => [index * 20, index + 10, 80 - index, 255]));
        const canvases: string[] = [];
        for (let offset = 8; offset + 12 <= output.length;) {
            const length = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0);
            if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "caNv") {
                canvases.push(Buffer.from(output.subarray(offset + 8, offset + 8 + length)).toString("hex"));
            }
            offset += length + 12;
        }
        expect(canvases).toEqual(canvas);
        expect(decoded.virtualCanvas ?? { width: decoded.width, height: decoded.height, x: 0, y: 0 })
            .toEqual(canvas.length ? { width: 9, height: 8, x: 2, y: 2 } : { width: 4, height: 3, x: 0, y: 0 });
    });
}
