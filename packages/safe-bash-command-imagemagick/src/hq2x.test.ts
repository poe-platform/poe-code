import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references for the 3x3 pixel-art reproduction.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const [method, hash] of [
        ["hq2x", "9055e6779e541073ae646ea7e21134f22f3598a5ec5a69a3aa0be7b304cc2cc6"],
        ["scale2x", "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a"]
    ]) {
        it.each(["info", "rgb"])(`${mode}: ${method} matches native %s output`, async format => {
            const colors = [[239, 64, 32], [34, 102, 238], [23, 223, 144]];
            const input = new Uint8Array([...new TextEncoder().encode("P6\n3 3\n255\n"), ...[0, 1, 1, 0, 0, 1, 2, 0, 0].flatMap(index => colors[index]!)]);
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["im.ppm", input], ["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/im.ppm", input);
            await filesystem.writeFile("/out", original);
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

// Native Q16-HDRI raw RGBA references: all 256 masks with equal neighbors,
// distinct neighbors, and alpha-only differences, spanning two 1024-pixel boundaries.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["edge", "7da9792fc13d8e7d03f1eed601b311e645107cddea0f359f069a5bd6ae72f01f"],
        ["background", "c21914e3c5a0db87372a6526f50d66258b479ed33104ba3885b3daa29c506ea1"]
    ])(`${mode}: HQ2X matches every native neighborhood with %s virtual pixels`, async (virtualPixel, hash) => {
        const width = 2304, center = [12345, 23456, 34567, 45678];
        const samples: number[] = [];
        for (let y = 0; y < 3; y++) for (let x = 0; x < width; x++) {
            const tile = Math.floor(x / 3), group = Math.floor(tile / 256), pattern = tile % 256;
            const position = y * 3 + x % 3, bit = position < 4 ? position : position - 1;
            const different = position !== 4 && (pattern & (1 << bit)) !== 0;
            const color = !different ? center : group === 0 ? [54321, 43210, 32109, 21098]
                : group === 1 ? [1000 + position * 6000, 65000 - position * 6000, 5000 + position * 4000, 3000 + position * 7000]
                : [...center.slice(0, 3), 1000 + position * 7000];
            samples.push(...color.flatMap(value => [value >> 8, value & 255]));
        }
        const input = new Uint8Array([...new TextEncoder().encode(`P7\nWIDTH ${width}\nHEIGHT 3\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), ...samples]);
        const files = new Map([["/in.pam", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", input);
        const args = ["/in.pam", "-background", "#12345678", "-virtual-pixel", virtualPixel!, "-define", "magnify:method=HQ2X", "-magnify", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(width * 2 * 6 * 8);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
