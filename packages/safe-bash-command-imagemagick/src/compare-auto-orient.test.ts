import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160].flatMap(value => [value, value + 10, value + 20, 255]));
const orders = [[0, 1, 2, 3, 4, 5], [2, 1, 0, 5, 4, 3], [5, 4, 3, 2, 1, 0], [3, 4, 5, 0, 1, 2],
    [0, 3, 1, 4, 2, 5], [3, 0, 4, 1, 5, 2], [5, 2, 4, 1, 3, 0], [2, 5, 1, 4, 0, 3]];

for (const mode of ["sync", "async", "magick", "retained", "command"] as const) {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(`compares TIFF orientation %s against independent pixels (${mode})`, async orientation => {
        const input = encodeImage({ width: 3, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3,
            depth: "uchar", density: 72, hasAlpha: false, orientation }, { format: "tiff" }).data;
        for (const position of ["before", "between", "after", "twice", "none"] as const) {
            const oriented = position !== "none";
            const width = oriented && orientation >= 5 ? 2 : 3, height = 6 / width;
            const order = orders[oriented ? orientation - 1 : 0]!;
            const reference = new Uint8Array([...new TextEncoder().encode(`P6\n${width} ${height}\n255\n`),
                ...order.flatMap(index => Array.from(pixels.subarray(index * 4, index * 4 + 3)))]);
            const files = new Map([["/input.tif", input], ["/reference.ppm", reference]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["-metric", "RMSE", ...(position === "before" ? ["-auto-orient"] : []), "/input.tif",
                ...(["between", "twice"].includes(position) ? ["-auto-orient"] : []), "/reference.ppm",
                ...(["after", "twice"].includes(position) ? ["-auto-orient"] : []), "/diff.png"];
            const args = createCommandArguments(["compare", ...argv]);
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runCompareCliSync(argv, files)
                : mode === "magick" ? await runMagickCli(["compare", ...argv], files)
                : mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
                : await runCompareCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(mode === "command" ? { ...result, stdout, stderr } : result, position).toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0)\n" });
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/diff.png") : files.get("/diff.png")!;
            expect(decodeImage(output), position).toMatchObject({ width, height });
        }
    });
}

for (const retained of [false, true]) {
    it(`preserves crop and orientation operation order (retained=${retained})`, async () => {
        const input = encodeImage({ width: 3, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3,
            depth: "uchar", density: 72, hasAlpha: false, orientation: 6 }, { format: "tiff" }).data;
        for (const [operations, order, width, height] of [
            [["-crop", "2x2+0+0", "-auto-orient"], [3, 0, 4, 1], 2, 2],
            [["-auto-orient", "-crop", "1x2+0+0"], [3, 4], 1, 2]
        ] as const) {
            const reference = new Uint8Array([...new TextEncoder().encode(`P6\n${width} ${height}\n255\n`),
                ...order.flatMap(index => Array.from(pixels.subarray(index * 4, index * 4 + 3)))]);
            const files = new Map([["/input.tif", input], ["/reference.ppm", reference]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            expect(await runCompareCli(["-metric", "RMSE", "/input.tif", ...operations, "/reference.ppm", "/diff.png"],
                retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)\n" });
            const output = retained ? await filesystem.readFile("/diff.png") : files.get("/diff.png")!;
            expect(decodeImage(output)).toMatchObject({ width, height });
            // The operator between inputs must not orient the later TIFF.
            expect((await runCompareCli(["/input.tif", "-auto-orient", "/input.tif", "null:"],
                retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(1);
        }
    });
}
