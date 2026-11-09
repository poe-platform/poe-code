import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const pixels = Uint8Array.of(0, 40, 90, 0, 80, 100, 150, 128, 200, 50, 70, 255);
const input = encodeImage({ width: 3, height: 1, data: pixels, format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data;
// Decoded RGBA8 expectations verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const retained of [false, true]) {
    for (const coder of ["PNG", "PNG32", "PNG64"]) {
        it.each([
            [[], [0, 128, 255]],
            [["-alpha", "copy"], coder === "PNG" ? [35, 99, 83] : [255, 255, 255]],
            [["-alpha", "copy", "-alpha", "activate"], [35, 99, 83]],
            [["-alpha", "copy", "-alpha", "on"], [255, 255, 255]],
            [["-alpha", "copy", "-alpha", "set"], [255, 255, 255]],
            [["-alpha", "copy", "-alpha", "transparent"], [0, 0, 0]],
        ] as const)(`encodes %j with ${coder}, retained=${retained}`, async (options, alpha) => {
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const result = await runConvertCli(["/in.png", "-background", "#123456", ...options, `${coder}:/out.png`], retained ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect(Array.from(image.data)).toEqual([0, 40, 90, alpha[0], 80, 100, 150, alpha[1], 200, 50, 70, alpha[2]]);
        });
    }
    it(`preserves shape alpha with forced PNG32, retained=${retained}`, async () => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runConvertCli(["/in.png", "-background", "#123456", "-alpha", "shape", "PNG32:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(image.data)).toEqual([18, 52, 86, 35, 18, 52, 86, 99, 18, 52, 86, 83]);
    });
    it(`keeps copied alpha after a forced PNG32 write, retained=${retained}`, async () => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runConvertCli(["/in.png", "-background", "#123456", "-alpha", "copy", "-write", "PNG32:/forced.png", "/ordinary.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        for (const [name, alpha] of [["forced", [255, 255, 255]], ["ordinary", [35, 99, 83]]] as const) {
            const image = decodeImage(retained ? await filesystem.readFile(`/${name}.png`) : files.get(`/${name}.png`)!);
            expect(Array.from(image.data)).toEqual([0, 40, 90, alpha[0], 80, 100, 150, alpha[1], 200, 50, 70, alpha[2]]);
        }
    });
}

it("writes opaque PNG32 after alpha copy through the public command", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const errors: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["in.png", "-background", "#123456", "-alpha", "copy", "PNG32:out.png"]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
    });
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data)).toEqual([0, 40, 90, 255, 80, 100, 150, 255, 200, 50, 70, 255]);
});
