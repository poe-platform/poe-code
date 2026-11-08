import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "streamed", "symlink"] as const)
for (const flag of ["-identify", "-verbose", "-regard-warnings"])
it(`supports mogrify ${flag} (${mode})`, async () => {
    const bytes = await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["a.png", bytes], ["b.png", bytes]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/a.png", bytes);
    await filesystem.writeFile("/b.png", bytes);
    if (mode === "symlink") await filesystem.symlink("a.png", "/link.png");
    const names = [mode === "symlink" ? "link.png" : "a.png", "b.png"];
    const args = ["mogrify", flag, "-negate", ...names];
    let stdout = "", stderr = "";
    const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : {
        filesystem, cwd: "/", ...(mode === "streamed" ? {
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } : {})
    });
    expect(result.exitCode, result.stderr).toBe(0);
    stdout += result.stdout; stderr += result.stderr;
    for (const name of names) {
        const output = mode === "buffered" || mode === "sync" ? files.get(name)! : await filesystem.readFile("/" + name);
        expect(Array.from(decodeImage(output).data)).toEqual([0, 255, 255, 255, 255, 0, 255, 255]);
        if (flag !== "-regard-warnings") expect(stdout).toContain(`${name} PNG 2x1`);
        if (flag === "-verbose") expect(stderr).toContain(`${name} PNG 2x1`);
    }
    if (flag === "-regard-warnings") expect(stdout + stderr).toBe("");
    if (mode === "symlink") {
        expect(await filesystem.readFile("/a.png")).toEqual(bytes);
        expect((await filesystem.lstat("/link.png")).type).toBe("file");
    }
});

for (const retained of [false, true]) {
    it(`keeps earlier diagnostic output on later failure (retained=${retained})`, async () => {
        const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", bytes);
        const result = await runMagickCli(["mogrify", "-identify", "a.png", "missing.png"], retained ? { filesystem, cwd: "/" } : new Map([["a.png", bytes]]));
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("a.png PNG 2x1");
        expect(result.stderr).toContain("missing.png");
    });

    it(`disables diagnostic settings for subsequent inputs (retained=${retained})`, async () => {
        const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", bytes); await filesystem.writeFile("/b.png", bytes);
        const result = await runMagickCli(["mogrify", "-identify", "-verbose", "a.png", "+identify", "+verbose", "+regard-warnings", "b.png"], retained ? { filesystem, cwd: "/" } : new Map([["a.png", bytes], ["b.png", bytes]]));
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("a.png PNG 2x1");
        expect(result.stderr).toContain("a.png PNG 2x1");
        expect(result.stdout + result.stderr).not.toContain("b.png");
    });
}

for (const retained of [false, true])
for (const regard of [false, true])
it(`sets warning exit status only with -regard-warnings (retained=${retained}, regard=${regard})`, async () => {
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/a.png", bytes);
    let stderr = "";
    const result = await runMagickCli(["mogrify", ...(regard ? ["-regard-warnings"] : []), "-crop", "1x1+9+9", "a.png"], retained ? {
        filesystem, cwd: "/", stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } : new Map([["a.png", bytes]]));
    expect(result.exitCode).toBe(regard ? 1 : 0);
    expect(stderr + result.stderr).toContain("geometry does not contain image");
});
