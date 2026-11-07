import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each([
        { args: ["/a.png", "-negate", "/b.png"], negateA: false, negateB: true, fails: false },
        { args: ["/a.png", "/b.png", "-negate"], negateA: false, negateB: false, fails: false },
        { args: ["-negate", "/a.png", "/b.png"], negateA: true, negateB: true, fails: false },
        { args: ["-negate", "/a.png", "-resize", "1x1", "/missing.png", "/b.png"], negateA: true, negateB: false, fails: true }
    ])(`applies only operations preceding each mogrify input (${mode}): $args`, async ({ args, negateA, negateB, fails }) => {
        const pixels = [[255, 0, 0, 0, 255, 0], [0, 0, 255, 255, 255, 0]];
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const [index, path] of ["/a.png", "/b.png"].entries()) {
            const bytes = await sharp(Uint8Array.from(pixels[index]!), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
            files.set(path, bytes);
            await filesystem.writeFile(path, bytes);
        }
        if (mode === "retained-symlink") await filesystem.symlink("/a.png", "/link.png");
        const argv = ["mogrify", ...args.map(arg => mode === "retained-symlink" && arg === "/a.png" ? "/link.png" : arg)];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode.startsWith("retained") ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(fails ? 1 : 0);
        if (fails) expect(result.stderr).toContain("/missing.png");
        for (const [index, path] of ["/a.png", "/b.png"].entries()) {
            const decoded = decodeImage(mode.startsWith("retained") ? await filesystem.readFile(mode === "retained-symlink" && path === "/a.png" ? "/link.png" : path) : files.get(path)!);
            expect([decoded.width, decoded.height]).toEqual([2, 1]);
            const negate = index === 0 ? negateA : negateB;
            expect(Array.from(decoded.data).filter((_, channel) => channel % 4 !== 3)).toEqual(pixels[index]!.map(value => negate ? 255 - value : value));
        }
    });
}
