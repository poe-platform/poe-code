import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// RGB samples and page geometry captured from ImageMagick 7.1.2-35 Q16-HDRI.
const original = "ff0000ff0000ff0000ff0000ff000080008000ff008000808000808000800000ff0000ff0000ff0000ff0000ff";
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const page of ["12x9+3+2", "5x3+0+0", "plain", "reset"]) {
        it.each([
            ["4x3", 4, 2, "d01c13ba4900e50027dd0320131cd00049ba2700e52003dd"],
            ["5x3!", 5, 3, original],
            ["10x10>", 5, 3, original],
            ["2x2<", 5, 3, original],
        ] as const)(`resets thumbnail page ${page} for %s (${mode})`, async (geometry, width, height, rgb) => {
            const input = await sharp(Buffer.from(original, "hex"), { raw: { width: 5, height: 3, channels: 3 } }).png().toBuffer();
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const setup = await run(["/input.png", ...(page === "plain" ? [] : ["-repage", page === "reset" ? "12x9+3+2" : page]), "/part.png"]);
            expect(setup.exitCode, setup.stderr).toBe(0);
            const result = await run(["/part.png", ...(page === "reset" ? ["+repage"] : []), "-thumbnail", geometry, "PNG24:/output.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(`${width}x${height} ${width}x${height}+0+0`);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(rgb);
        });
    }
}
