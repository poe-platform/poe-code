import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./magnify-fixtures.json" with { type: "json" };

const rows = ["........", ".RR.....", "..RR..B.", "...RRBB.", "....RB..", "..GGG...", ".GG.....", "........"];
const palette: Record<string, number[]> = { ".": [20, 25, 30], R: [240, 30, 50], B: [30, 80, 250], G: [30, 210, 80] };
// Decoded RGB references from ImageMagick 7.1.2-31 Q16-HDRI, matching
// the 7.1.2-35 report. Store palette rows, never encoded PNG comparisons.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [method, reference] of fixtures as [string, string[]][]) {
        for (const explicit of method === "scale2x" ? [false, true] : [true]) {
            it(`${mode}: ${explicit ? method : "default"} magnify matches native RGB`, async () => {
                const input = await sharp(Uint8Array.from([...rows.join("")].flatMap(c => palette[c]!)), { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
                const files = new Map([["/art.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/art.png", input);
                const args = ["/art.png", ...(explicit ? ["-define", `magnify:method=${method}`] : []), "-magnify", "/out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode, result.stderr).toBe(0);
                const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
                expect([output.width, output.height]).toEqual([reference[0]!.length, reference.length]);
                expect([...output.data]).toEqual([...reference.join("")].flatMap(c => [...palette[c]!, 255]));
            });
        }
    }
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode}: clearing the method restores 2x and preserves 16-bit alpha pixels across chunks`, async () => {
        const width = 1025;
        const samples = [12345, 23456, 34567, 45678];
        const input = Uint8Array.from(Array.from({ length: width }, () => samples.flatMap(value => [value >> 8, value & 255])).flat());
        const pam = new Uint8Array([...new TextEncoder().encode(`P7\nWIDTH ${width}\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), ...input]);
        const files = new Map([["/in.pam", pam]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", pam);
        const args = ["/in.pam", "-define", "png:bit-depth=16", "-define", "png:color-type=6", "-define", "magnify:method=scale3x", "+define", "magnify:method", "-magnify", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([width * 2, 2]);
        expect([...decoded.data16!]).toEqual(Array.from({ length: width * 4 }, () => samples).flat());
    });
}
