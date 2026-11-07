import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each([undefined, "png"])(`preserves extensionless mogrify basenames unless format is explicit: %s (${mode})`, async format => {
        const original = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input", original);
        await filesystem.mkdir("/dest");
        const symlink = mode === "retained-symlink";
        if (symlink) await filesystem.symlink("input", "/link");
        const target = symlink ? "/link" : "/input";
        const argv = ["mogrify", "-path", "/dest", "-negate", ...(format ? ["-format", format] : []), target];
        const retained = mode.startsWith("retained");
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = `${target.slice(1)}${format ? ".png" : ""}`;
        const names = retained ? (await filesystem.readdir("/dest")).map(entry => entry.name)
            : [...files.keys()].filter(path => path.startsWith("/dest/")).map(path => path.slice(6));
        expect(names).toEqual([output]);
        expect(retained ? await filesystem.readFile("/input") : files.get("/input")).toEqual(original);
        const bytes = retained ? await filesystem.readFile(`/dest/${output}`) : files.get(`/dest/${output}`)!;
        expect(Array.from(decodeImage(bytes).data)).toEqual([0, 255, 255, 255, 255, 0, 255, 255]);
        if (symlink) expect((await filesystem.lstat(target)).type).toBe("symlink");
    });
}
