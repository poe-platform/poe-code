import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        [["-crop", "2x2+1+1"], "2x2 +1 +1 5x5"],
        [["-repage", "8x8+2+3"], "5x5 +2 +3 8x8"],
        [["-crop", "2x2+1+1", "+repage"], "2x2 +0 +0 2x2"],
        [["-repage", "8x8-2-3"], "5x5 -2 -3 8x8"],
        [["-repage", "8x8+2+3", "-repage", "9x9"], "5x5 +2 +3 9x9"],
        [["-repage", "8x8+2+3", "-repage", "+1+1!"], "5x5 +3 +4 8x8"],
        [["-crop", "2x2+1+1", "-repage", "+2+3"], "2x2 +2 +3 5x5"],
    ])("preserves native canvas geometry for %j (retained=" + retained + ")", async (options, expected) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["-size", "5x5", "gradient:black-white", ...options, "/output.png"], backend)).exitCode).toBe(0);
        const result = await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "/output.png"], backend);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(expected);
        const bytes = retained ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect((await runMagickCli(["/output.png", "/copy.png"], backend)).exitCode).toBe(0);
        const copy = retained ? await filesystem.readFile("/copy.png") : files.get("/copy.png")!;
        expect(decodeImage(copy)).toEqual(decodeImage(bytes));
    });
}
