import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each([
        { args: ["/a.png", "-negate", "/b.png"], negateA: false, negateB: true, fails: false },
        { args: ["/a.png", "/b.png", "-negate"], negateA: false, negateB: false, fails: false },
        { args: ["-negate", "/a.png", "/b.png"], negateA: true, negateB: true, fails: false },
        { args: ["-negate", "/a.png", "-flop", "/missing.png", "/b.png"], negateA: true, negateB: true, fails: true }
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
            const expected = pixels[index]!.map(value => negate ? 255 - value : value);
            expect(Array.from(decoded.data).filter((_, channel) => channel % 4 !== 3)).toEqual(fails && index === 1 ? [...expected.slice(3), ...expected.slice(0, 3)] : expected);
        }
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["-format", "gif", "/a.png", "-format", "bmp", "/b.png"], outputs: ["/a.gif", "/b.bmp"] },
        { args: ["-path", "/dest", "/a.png", "-path", "/dest2", "/b.png"], outputs: ["/dest/a.png", "/dest2/b.png"] },
        { args: ["/a.png", "-format", "gif", "/b.png"], outputs: ["/a.png", "/b.gif"] },
        { args: ["/a.png", "-path", "/dest", "/b.png"], outputs: ["/a.png", "/dest/b.png"] },
        { args: ["-format", "gif", "/a.png", "/b.png"], outputs: ["/a.gif", "/b.gif"] },
        { args: ["-path", "/dest", "/a.png", "/b.png"], outputs: ["/dest/a.png", "/dest/b.png"] },
        { args: ["/a.png", "/b.png", "-path", "/dest", "-format", "gif"], outputs: ["/a.png", "/b.png"] },
        { args: ["-path", "/dest", "-format", "gif", "/a.png", "-path", "/dest2", "-format", "bmp", "/b.png"], outputs: ["/dest/a.gif", "/dest2/b.bmp"] }
    ])(`binds mogrify output settings to each input (${mode}): $args`, async ({ args, outputs }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/dest");
        await filesystem.mkdir("/dest2");
        for (const [index, path] of ["/a.png", "/b.png"].entries()) {
            const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: index === 0 ? "red" : "blue" } }).png().toBuffer();
            files.set(path, bytes);
            await filesystem.writeFile(path, bytes);
        }
        const originals = [...files.values()].map(bytes => decodeImage(bytes));
        const argv = ["mogrify", ...args];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const expectedPaths = [...new Set(["/a.png", "/b.png", ...outputs])].sort();
        const actualPaths = mode === "retained"
            ? (await Promise.all(["", "/dest", "/dest2"].map(async dir =>
                (await filesystem.readdir(dir || "/")).filter(entry => entry.type === "file").map(entry => `${dir}/${entry.name}`)))).flat()
            : [...files.keys()];
        expect(actualPaths.sort()).toEqual(expectedPaths);
        for (const [index, path] of outputs.entries()) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const decoded = decodeImage(bytes);
            expect([decoded.width, decoded.height, decoded.data]).toEqual([2, 1, originals[index]!.data]);
            expect((await sharp(bytes).metadata()).format).toBe(path.slice(path.lastIndexOf(".") + 1));
        }
    });
}
