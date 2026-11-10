import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
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

// ImageMagick 7.1.2-35 Q16-HDRI reference for the 3x3 PPM reproduction.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([undefined, "scale2x", "bogus", "none", "", "other-method"])(`${mode}: magnify method %s uses the native Scale2x fallback`, async method => {
        const colors = [[239, 64, 32], [34, 102, 238], [23, 223, 144]];
        const input = new Uint8Array([...new TextEncoder().encode("P6\n3 3\n255\n"), ...[0, 1, 1, 0, 0, 1, 2, 0, 0].flatMap(index => colors[index]!)]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["im.ppm", input], ["out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/im.ppm", input);
        await filesystem.writeFile("/out", original);
        const args = ["im.ppm", ...(method === undefined ? [] : ["-define", `magnify:method=${method}`]), "-magnify", "-depth", "8", "rgb:out"];
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
        expect(output).toHaveLength(108);
        expect(createHash("sha256").update(output).digest("hex")).toBe("4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a");
    });
}

it.each(["eagle3xb", "fish2x"])("does not silently substitute Scale2x for unsupported %s", async method => {
    const filesystem = new MemoryFileSystem();
    const original = new TextEncoder().encode("KEEP");
    await filesystem.writeFile("/out", original);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["xc:red", "-define", `magnify:method=${method}`, "-magnify", "-depth", "8", "rgb:out"],
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(`Unsupported magnify method: ${method}`);
    expect(await filesystem.readFile("/out")).toEqual(original);
});
