import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each(["no-such-coder", ".gif", "GIF"])(`validates explicit mogrify format %s (${mode})`, async format => {
        const original = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/a.png", original], ["/b.png", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const symlink = mode === "retained-symlink";
        if (symlink) await filesystem.symlink("a.png", "/link.png");
        const target = symlink ? "/link.png" : "/a.png";
        const argv = ["mogrify", "-negate", "/b.png", "-format", format, target];
        const retained = mode.startsWith("retained");
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(format === "GIF" ? 0 : 1);
        if (format !== "GIF") expect(result.stderr).toContain(format);
        const read = async (path: string) => retained ? filesystem.readFile(path) : files.get(path)!;
        expect(await read("/a.png")).toEqual(original);
        expect(Array.from(decodeImage(await read("/b.png")).data)).toEqual([0, 255, 255, 255, 255, 0, 255, 255]);
        const output = symlink ? "/link.gif" : "/a.gif";
        const names = retained ? (await filesystem.readdir("/")).map(entry => "/" + entry.name) : [...files.keys()];
        expect(names.sort()).toEqual(["/a.png", "/b.png", ...(symlink ? ["/link.png"] : []), ...(format === "GIF" ? [output] : [])].sort());
        if (format === "GIF") {
            const bytes = await read(output);
            expect(new TextDecoder().decode(bytes.subarray(0, 6))).toMatch(/^GIF8[79]a$/);
            expect(Array.from(decodeImage(bytes).data)).toEqual([0, 255, 255, 255, 255, 0, 255, 255]);
        }
        if (symlink) expect((await filesystem.lstat(target)).type).toBe("symlink");
    });
}
