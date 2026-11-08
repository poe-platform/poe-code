import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

for (const mode of ["sync", "memory", "retained", "magick"] as const) {
    for (const [option, color, pixels] of [
        ["-highlight-color", "bogus", [207, 210, 214, 255, 0, 0, 0, 255]],
        ["-lowlight-color", "bogus", [0, 0, 0, 255, 218, 29, 56, 255]],
        ["-highlight-color", "lime", [207, 210, 214, 255, 0, 255, 0, 255]]
    ] as const) {
        it(`compares with ${option} ${color} through ${mode}`, async () => {
            const a = await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 160, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const b = await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 240, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["a.png", a], ["b.png", b]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = [option, color, "a.png", "b.png", "diff.png"];
            const result = await (mode === "sync" ? runCompareCliSync(args, files)
                : mode === "magick" ? runMagickCli(["compare", ...args], files)
                : runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files));
            expect(result).toEqual({
                exitCode: 1, stdout: "",
                stderr: "7269.06 (0.110919)\n" + (color === "bogus" ? "compare: unrecognized color `bogus'\n" : "")
            });
            const output = mode === "retained" ? await filesystem.readFile("/diff.png") : files.get("diff.png")!;
            expect([...decodeImage(output).data]).toEqual(pixels);
        });
    }
}
