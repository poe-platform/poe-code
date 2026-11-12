import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["[ab].png", "[a-b].png", "?.png", "*.png", "{a,b}.png"])(`expands literal mogrify patterns: %s (${mode})`, async pattern => {
        const source = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        for (const format of [undefined, "gif"]) {
            const files = new Map([["/images/a.png", source], ["/images/b.png", source]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.mkdir("/images");
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const argv = ["mogrify", "-negate", ...(format ? ["-format", format] : []), `/images/${pattern}`];
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            for (const name of ["a", "b"]) {
                const output = `/images/${name}.${format ?? "png"}`;
                const bytes = mode === "retained" ? await filesystem.readFile(output) : files.get(output)!;
                expect(Array.from(decodeImage(bytes).data)).toEqual([0, 255, 255, 255, 255, 0, 255, 255]);
                if (format) expect(mode === "retained" ? await filesystem.readFile(`/images/${name}.png`) : files.get(`/images/${name}.png`)).toEqual(source);
            }
        }
    });
    it(`retains no-match errors (${mode})`, async () => {
        const files = new Map<string, Uint8Array>();
        const argv = ["mogrify", "-negate", "[z].png"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("[z].png");
        expect(files.size).toBe(0);
    });
}

it("expands relative symlink names and replaces links without editing their targets", async () => {
    const source = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/images");
    await filesystem.writeFile("/original.png", source);
    await filesystem.symlink("/original.png", "/images/a.png");
    await filesystem.writeFile("/images/.hidden.png", source);
    await filesystem.mkdir("/images/directory.png");
    const result = await runMagickCli(["mogrify", "-negate", "*.png"], { filesystem, cwd: "/images" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await filesystem.lstat("/images/a.png")).type).toBe("file");
    expect(Array.from(decodeImage(await filesystem.readFile("/images/a.png")).data)).toEqual([0, 255, 255, 255]);
    expect(await filesystem.readFile("/original.png")).toEqual(source);
    expect(await filesystem.readFile("/images/.hidden.png")).toEqual(source);
});

it("does not expand option arguments or wildcard parent directories", async () => {
    const source = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["/a.png", source]]);
    const result = await runMagickCli(["mogrify", "-set", "comment", "[ab].png", "-negate", "/*.png"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(new TextDecoder().decode(files.get("/a.png"))).toContain("[ab].png");
    const unmatched = await runMagickCli(["mogrify", "-negate", "/im?ges/*.png"], files);
    expect(unmatched.exitCode).toBe(1);
});
