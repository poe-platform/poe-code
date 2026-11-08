import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", [114, 184, 230, 160]],
        ["+sigmoidal-contrast", [91, 125, 164, 160]],
    ] as const)(`matches native %s with explicit RGB via ${mode}`, async (option, expected) => {
        const input = await sharp(Uint8Array.from([
            100, 150, 200, 160, 0, 255, 0, 160
        ]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-channel", "RGB", option, "5x40%", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...expected, 0, 255, 0, 160]);
    });
}
