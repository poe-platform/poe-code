import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

for (const mode of ["sync", "async", "magick", "retained"] as const) {
    for (const extra of ["c.png", "absent.png", "broken.png"]) {
        it(`preserves extra input ${extra} and writes the final destination (${mode})`, async () => {
            const images = await Promise.all([
                [16, 32, 48, 255, 128, 144, 160, 255],
                [16, 32, 48, 255, 128, 144, 240, 255],
                [170, 238, 51, 255, 119, 119, 119, 255]
            ].map(pixels => sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
            const files = new Map<string, Uint8Array>([["a.png", images[0]!], ["b.png", images[1]!], ["c.png", images[2]!], ["broken.png", new Uint8Array([1, 2, 3])]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const original = new Map(Array.from(files, ([name, bytes]) => [name, bytes.slice()]));
            const args = ["a.png", "b.png", extra, "o.png"];
            const result = mode === "sync" ? runCompareCliSync(args, files)
                : mode === "magick" ? await runMagickCli(["compare", ...args], files)
                : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(extra === "c.png" ? 1 : 2);
            expect(result.stdout).toBe("");
            if (extra === "absent.png") expect(result.stderr).toContain("unable to open image 'absent.png'");
            if (extra === "broken.png") expect(result.stderr).toContain("improper image header");
            for (const [name, bytes] of original) {
                expect(mode === "retained" ? await filesystem.readFile(`/${name}`) : files.get(name)).toEqual(bytes);
            }
            if (mode === "retained") await expect(filesystem.readFile("/absent.png")).rejects.toThrow();
            else expect(files.has("absent.png")).toBe(false);
            const output = mode === "retained" ? await filesystem.readFile("/o.png") : files.get("o.png");
            expect(output).toBeDefined();
            expect(Array.from(await sharp(output!).ensureAlpha().raw().toBuffer())).toEqual([207, 210, 214, 255, 218, 29, 56, 255]);
        });
    }
}
