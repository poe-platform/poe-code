import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

function sampling(bytes: Uint8Array): number[] {
    for (let at = 2; at < bytes.length;) {
        const marker = bytes[at + 1], length = bytes[at + 2]! * 256 + bytes[at + 3]!;
        if (marker === 0xc0) return [bytes[at + 11]!, bytes[at + 14]!, bytes[at + 17]!];
        at += length + 2;
    }
    throw new Error("Missing JPEG frame");
}

for (const retained of [false, true]) {
    it.each([["2x2", 0x22], ["2x1", 0x21], ["1x2", 0x12], ["1x1", 0x11], ["2x2,1x1,1x1", 0x22], ["4:2:0", 0x22]] as const)(`writes %s JPEG sampling, retained=${retained}`, async (factor, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["-size", "19x17", "xc:#356acb", "-sampling-factor", factor, "-quality", "90", "-write", "copy.jpg", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        for (const path of ["copy.jpg", "out.jpg"]) {
            const bytes = retained ? await fs.readFile(`/${path}`) : files.get(path)!;
            expect(sampling(bytes)).toEqual([expected, 0x11, 0x11]);
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual([19, 17]);
            for (let i = 0; i < image.data.length; i++) expect(Math.abs(image.data[i]! - [53, 106, 203, 255][i % 4]!)).toBeLessThanOrEqual(3);
        }
    });
}

for (const retained of [false, true]) {
    it(`captures sampling for each write and resets it, retained=${retained}`, async () => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["-size", "8x8", "xc:red", "-quality", "75", "-sampling-factor", "1x1", "-write", "copy.jpg", "+sampling-factor", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(sampling(retained ? await fs.readFile("/copy.jpg") : files.get("copy.jpg")!)).toEqual([0x11, 0x11, 0x11]);
        expect(sampling(retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")!)).toEqual([0x22, 0x11, 0x11]);
    });
    it.each(["0x2", "5x1", "4x4", "2x2,3x1,1x1", "invalid"])(`rejects invalid sampling %s, retained=${retained}`, async factor => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = runConvertCli(["xc:red", "-sampling-factor", factor, "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        if (retained) {
            await expect(result).rejects.toThrow("Invalid JPEG sampling factor");
            await expect(fs.readFile("/out.jpg")).rejects.toThrow();
        } else {
            expect(await result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Invalid JPEG sampling factor") });
            expect(files.has("out.jpg")).toBe(false);
        }
    });
}

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable)("matches native sampling for the reported colorful PNG", async () => {
    const raw = Uint8Array.from({ length: 256 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const png = spawnSync("magick", ["-size", "8x8", "-depth", "8", "RGBA:-", "png:-"], { input: raw });
    expect(png.status).toBe(0);
    const native = spawnSync("magick", ["png:-", "-sampling-factor", "2x2", "-quality", "90", "jpeg:-"], { input: png.stdout });
    expect(native.status).toBe(0);
    for (const retained of [false, true]) {
        const fs = new MemoryFileSystem(), files = new Map([["in.png", png.stdout]]);
        await fs.writeFile("/in.png", png.stdout);
        const result = await runConvertCli(["in.png", "-sampling-factor", "2x2", "-quality", "90", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")!;
        expect(sampling(output)).toEqual(sampling(native.stdout));
        const metadata = spawnSync("magick", ["identify", "-format", "%Q %[jpeg:sampling-factor]", "jpeg:-"], { input: output, encoding: "utf8" });
        expect(metadata.status, metadata.stderr).toBe(0);
        expect(metadata.stdout).toBe("90 2x2,1x1,1x1");
    }
});
