import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "retained-symlink", "sync"] as const) {
    it.each([
        ["-write", "/snap.png", "-negate", "-flop"],
        ["-negate", "-write", "/snap.png", "-flop"],
        ["-negate", "-flop", "-write", "/snap.png"],
        ["+write", "/snap.png", "-negate", "-flop"],
        ["-write", "/first.png", "-negate", "-write", "/snap.png", "-flop"]
    ])(`writes final mogrify pixels for each input (${mode}): %j`, async (...options) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const [name, pixels] of [
            ["/a.png", [255, 0, 0, 0, 255, 0]],
            ["/b.png", [0, 0, 255, 255, 255, 255]]
        ] as const) {
            const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
            files.set(name, bytes);
            await filesystem.writeFile(name, bytes);
        }
        const symlink = mode === "retained-symlink", retained = mode.startsWith("retained");
        if (symlink) await filesystem.symlink("/a.png", "/link.png");
        const argv = ["mogrify", ...options, symlink ? "/link.png" : "/a.png", "-write", "/second.png", "/b.png"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const outputs = [symlink ? "/link.png" : "/a.png", "/b.png", "/snap.png", "/second.png", ...(options.includes("/first.png") ? ["/first.png"] : [])];
        for (const [index, name] of outputs.entries()) {
            const decoded = decodeImage(retained ? await filesystem.readFile(name) : files.get(name)!);
            expect([decoded.width, decoded.height]).toEqual([2, 1]);
            expect(Array.from(decoded.data)).toEqual(index === 0
                ? [255, 0, 255, 255, 0, 255, 255, 255]
                : [0, 0, 0, 255, 255, 255, 0, 255]);
        }
        if (symlink) {
            expect((await filesystem.lstat("/link.png")).type).toBe("file");
            expect(await filesystem.readFile("/a.png")).toEqual(files.get("/a.png"));
        }
    });

    it(`preserves intermediate convert writes (${mode})`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const argv = ["-size", "2x1", "xc:red", "-write", "/snap.png", "-negate", "/final.png"];
        const retained = mode.startsWith("retained");
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        for (const name of ["/snap.png", "/final.png"]) {
            const decoded = decodeImage(retained ? await filesystem.readFile(name) : files.get(name)!);
            expect(Array.from(decoded.data.slice(0, 4))).toEqual(name === "/snap.png" ? [255, 0, 0, 255] : [0, 255, 255, 255]);
        }
    });
}
