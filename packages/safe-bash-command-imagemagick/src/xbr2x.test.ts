import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = [[239, 64, 32], [34, 102, 238], [23, 223, 144]];
const input = new Uint8Array([...new TextEncoder().encode("P6\n3 3\n255\n"), ...[0, 1, 1, 0, 0, 1, 2, 0, 0].flatMap(index => colors[index]!)]);
// ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB from the public-command reproduction.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const [method, hash] of [
        ["xbr2x", "19ce5ad74e93313c1e66a9b4e2c62df08d4a3ff4794b11f18afeaebee199a1d8"],
        ["scale2x", "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a"]
    ]) {
        it.each(["info", "rgb"])(`${mode}: ${method} matches native %s output`, async format => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["im.ppm", input], ["out", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/im.ppm", input);
            await filesystem.writeFile("/out", keep);
            const args = ["im.ppm", "-define", `magnify:method=${method}`, "-magnify", ...(format === "info" ? ["-format", "%wx%h"] : ["-depth", "8"]), `${format}:out`];
            let stdout = "", stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout).toBe("");
            expect(result.stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
            if (format === "info") expect(new TextDecoder().decode(output)).toBe("6x6");
            else {
                expect(output).toHaveLength(108);
                expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
            }
        });
    }
}

// Native Q16-HDRI references exercise alpha, integer blend truncation, the two-pixel
// virtual border, and neighborhoods spanning the 1024-pixel retained-raster chunk.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["edge", "9ba162e086c51d1b3e854470a330eb1522b9c774fc3c27dba54fa177b2a66bdc"],
        ["tile", "b6636fd8ef8b9022a5bb07bdff9085bb2a6c1fb94a2a22cbc9bafd1690254911"],
        ["background", "1d1deba1a426527cc38706366e8699410167efea97fb56d4e9f0d24c82e0f01d"],
        ["transparent", "d5727cd9bf5dbcf8e3d43626a178bf5a6651a0578943f1320ea70eb5a3b11962"]
    ])(`${mode}: XBR2x preserves native 16-bit alpha with %s virtual pixels across chunks`, async (virtual, hash) => {
        const width = 1025, palette = [[12345, 23456, 34567, 45678], [54321, 43210, 32109, 12345], [7777, 33333, 55555, 65535]];
        const art = [0, 1, 1, 0, 0, 1, 2, 0, 0];
        const samples = Array.from({ length: width * 3 }, (_, index) => palette[art[Math.floor(index / width) * 3 + index % width % 3]!]!).flat();
        const pam = new Uint8Array([...new TextEncoder().encode(`P7\nWIDTH ${width}\nHEIGHT 3\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), ...samples.flatMap(value => [value >> 8, value & 255])]);
        const files = new Map([["/in.pam", pam]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", pam);
        const args = ["/in.pam", "-background", "#12345678", "-virtual-pixel", virtual, "-define", "magnify:method=XBR2x", "-magnify", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(width * 3 * 4 * 4 * 2);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
