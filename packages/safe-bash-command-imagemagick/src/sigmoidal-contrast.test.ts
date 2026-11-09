import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        [[], [114, 184, 230, 195]],
        [["-channel", "Default"], [114, 184, 230, 195]],
        [["-channel", "All"], [114, 184, 230, 195]],
        [["-channel", "RGB"], [114, 184, 230, 160]],
        [["-channel", "RGBA"], [114, 184, 230, 195]],
        [["-channel", "A"], [100, 150, 200, 195]],
        [["-channel", "R"], [114, 150, 200, 160]],
        [["-channel", "RGB", "+channel"], [114, 184, 230, 195]],
        [["-alpha", "off"], [114, 184, 230, 255]],
        [["-alpha", "off", "-channel", "Default"], [114, 184, 230, 255]],
        [["-alpha", "off", "-channel", "RGBA"], [114, 184, 230, 255]],
    ] as const)(`matches native sigmoidal contrast with %j via ${mode}`, async (options, expected) => {
        // Native magick: input.png [options] -sigmoidal-contrast 5x40% -depth 8 rgba:-
        const input = await sharp(Uint8Array.from([100, 150, 200, 160]), {
            raw: { width: 1, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...options, "-sigmoidal-contrast", "5x40%", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
