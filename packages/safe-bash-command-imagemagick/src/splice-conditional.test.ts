import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: conditional splice replaces both bands together.
// Center anchors for these band sizes include native gravity rounding.
const cases = [
    ["2x1+0+0<", 5, 4, 2, 2], ["8x7+0+0>", 5, 4, 2, 2],
    ["2x1+0+0>", 2, 1, 2, 1], ["8x7+0+0<", 8, 7, 3, 2],
    ["2x7+0+0<", 2, 7, 2, 2], ["2x7+0+0>", 2, 7, 2, 2],
    ["8x1+0+0<", 8, 1, 3, 1], ["8x1+0+0>", 8, 1, 3, 1],
    ["5x1<", 5, 1, 2, 1], ["2x4<", 2, 4, 2, 2],
    ["5x7>", 5, 7, 2, 2], ["8x4>", 8, 4, 3, 2],
    ["0x1<", 0, 1, 2, 1], ["2x0<", 2, 0, 2, 2],
    ["40x25%<", 5, 4, 2, 2], ["160x175%>", 5, 4, 2, 2],
    ["2x1+1+1<", 5, 4, 2, 2], ["8x7-1-1>", 5, 4, 2, 2],
] as const;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const gravity of ["NorthWest", "Center", "SouthEast"]) {
        it.each(cases)(`matches conditional splice dimensions, page and pixels (${mode}, ${gravity}, %s)`, async (geometry, columns, rows, centerX, centerY) => {
            const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => [i, 0, 0, 255]).flat());
            const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["/in.png", "-background", "white", "-gravity", gravity, "-splice", geometry, "PNG24:/out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([5 + columns, 4 + rows]);
            expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 })
                .toEqual({ width: 5 + columns, height: 4 + rows, x: 0, y: 0 });
            const bandX = gravity === "NorthWest" ? 0 : gravity === "Center" ? centerX : 5;
            const bandY = gravity === "NorthWest" ? 0 : gravity === "Center" ? centerY : 4;
            const expected = [];
            for (let y = 0; y < 4 + rows; y++) {
                for (let x = 0; x < 5 + columns; x++) {
                    if ((x >= bandX && x < bandX + columns) || (y >= bandY && y < bandY + rows)) {
                        expected.push(255, 255, 255, 255);
                    } else {
                        const sourceX = x < bandX ? x : x - columns;
                        const sourceY = y < bandY ? y : y - rows;
                        expected.push(sourceY * 5 + sourceX, 0, 0, 255);
                    }
                }
            }
            expect(output.data).toEqual(Uint8Array.from(expected));
        });
    }
}
