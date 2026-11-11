import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each(["option", "missing", "corrupt", "trailing-option", "trailing-argument"] as const)(`retains completed mogrify edits before a later %s failure (${mode})`, async failure => {
        const pixels = [255, 0, 0, 0, 255, 0];
        const original = await sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/a.png", original], ["/b.png", original], ["/corrupt.png", new Uint8Array([1, 2, 3])]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const symlink = mode === "retained-symlink";
        if (symlink) await filesystem.symlink("/a.png", "/link.png");
        const target = symlink ? "/link.png" : "/a.png";
        const failingArg = failure === "trailing-argument" ? "-resize" : failure.endsWith("option") ? "-no-such-option" : `/${failure}.png`;
        const argv = ["mogrify", "-negate", target, failingArg, ...(failure.startsWith("trailing-") ? [] : ["/b.png"])];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode.startsWith("retained") ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(failure === "corrupt" ? "unsupported image format" : failingArg);
        const edited = mode.startsWith("retained") ? await filesystem.readFile(target) : files.get(target)!;
        expect(Array.from(decodeImage(edited).data).filter((_, index) => index % 4 !== 3)).toEqual(pixels.map(value => 255 - value));
        const later = mode.startsWith("retained") ? await filesystem.readFile("/b.png") : files.get("/b.png")!;
        if (failure === "missing" || failure === "corrupt") expect(Array.from(decodeImage(later).data).filter((_, index) => index % 4 !== 3)).toEqual(pixels.map(value => 255 - value));
        else expect(later).toEqual(original);
        if (symlink) {
            expect(await filesystem.readFile("/a.png")).toEqual(original);
            expect((await filesystem.lstat(target)).type).toBe("file");
        }
        expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(["a.png", "b.png", "corrupt.png", ...(symlink ? ["link.png"] : [])].sort());
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        [ ["-resize"], "missing argument" ],
        [ ["-format"], "missing argument" ],
        [ ["-path"], "missing argument" ],
        [ ["-density"], "missing argument" ],
        [ ["-annotate", "+0+0"], "missing argument" ],
        [ ["-set", "comment"], "missing argument" ],
        [ ["-morphology", "Dilate"], "missing argument" ],
        [ ["-no-such-option"], "unrecognized option" ],
        [ ["-negate"], "" ],
        [ ["-resize", "50%"], "" ],
    ] as const)(`validates target-free mogrify options %j (${mode})`, async (args, error) => {
        const argv = ["mogrify", ...args];
        const files = new Map<string, Uint8Array>();
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files);
        expect(result.exitCode).toBe(error ? 1 : 0);
        expect(result.stderr).toContain(error);
    });
}
