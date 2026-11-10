import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references for the 3x3 pixel-art reproduction.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const [method, hash] of [
        ["fish2x", "f0c7698bad4c48e71667d3f077984fc9eb06d2b2a6254f55a4e0e06a29a68c5b"],
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

// All 256 arrangements of four Q16 RGBA colors in the Fish2x 2x2 neighborhood.
// Two colors share RGB but have different alpha. Width 1025 crosses a read chunk.
// References: ImageMagick 7.1.2-35 Q16-HDRI, raw 16-bit RGBA.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Rec709Luma", "edge", "1de10ebe195aff2e9efc51427d7b8d55a3719c67190468c8d57c654cab167490"],
        ["Brightness", "tile", "47f581164de34b29538dbecebabece7f16a1c8a76e3447d1126518a75f293e13"],
        ["Rec709Luminance", "background", "34606efd9b6b0064925519d752986eadb2ecfa49a53a72e18c1bfc8f2540251b"]
    ])(`${mode}: Fish2x preserves native Q16 blends with %s intensity and %s virtual pixels`, async (intensity, virtualPixel, hash) => {
        const palette = [[12345, 4567, 54321, 65535], [54321, 12345, 4567, 23456], [12345, 4567, 54321, 12345], [23456, 45678, 12345, 0]];
        const top: number[] = [], bottom: number[] = [];
        for (let i = 0; i < 256; i++) {
            const a = (i >> 6) & 3, b = (i >> 4) & 3, d = (i >> 2) & 3, e = i & 3;
            top.push(a, b, a, b);
            bottom.push(d, e, d, e);
        }
        top.push(0);
        bottom.push(3);
        const input = new Uint8Array([
            ...new TextEncoder().encode("P7\nWIDTH 1025\nHEIGHT 2\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            ...[...top, ...bottom].flatMap(index => palette[index]!.flatMap(value => [value >> 8, value & 255]))
        ]);
        const files = new Map([["in.pam", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", input);
        const args = ["in.pam", "-intensity", intensity!, "-background", "#3579bd80", "-virtual-pixel", virtualPixel!, "-define", "magnify:method=fish2x", "-magnify", "-depth", "16", "rgba:out"];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
        expect(output).toHaveLength(65600);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
