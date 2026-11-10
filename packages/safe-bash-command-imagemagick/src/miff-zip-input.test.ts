import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import fixtures from "./miff-zip-fixtures.json" with { type: "json" };

// Native ImageMagick fixtures: 4x2 big-endian RGBA input, -depth 8/16,
// -compress None/Zip/LZW miff:-. The 16-bit samples include low-order bits.
for (const fixture of fixtures) for (const mode of ["sync", "command"] as const) for (const flop of [false, true]) {
    it(`reads ${fixture.compression} MIFF depth=${fixture.depth}, ${mode}, flop=${flop}`, async () => {
        const input = Buffer.from(fixture.bytes, "base64"), fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["in.miff", input], ["out", Buffer.from("KEEP")]]);
        await fs.writeFile("/in.miff", input);
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["in.miff", ...(flop ? ["-flop"] : []), ...(fixture.depth === 8 ? ["-depth", "8", "rgba:out"] : ["PNG64:out"])];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const raw = Buffer.from(fixture.raw, "hex"), stride = fixture.depth / 8 * 4;
        const expected = Buffer.concat(Array.from({ length: 8 }, (_, pixel) => {
            const source = flop ? Math.floor(pixel / 4) * 4 + 3 - pixel % 4 : pixel;
            return raw.subarray(source * stride, (source + 1) * stride);
        }));
        const output = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (fixture.depth === 8) expect(Buffer.from(output)).toEqual(expected);
        else expect([...decodeImage(output).data16!]).toEqual(Array.from({ length: 32 }, (_, index) => expected.readUInt16BE(index * 2)));
    });
}

for (const kind of ["truncated", "oversized packet", "empty packet", "invalid zlib", "excess pixels"] as const) {
    it(`rejects ${kind} without replacing the destination`, async () => {
        const input = Buffer.from(fixtures.find(fixture => fixture.compression === "Zip" && fixture.depth === 16)!.bytes, "base64");
        const offset = input.indexOf(Buffer.from([58, 26])) + 2;
        if (kind === "oversized packet") input.writeUInt32BE(0xffffffff, offset);
        if (kind === "empty packet") input.writeUInt32BE(0, offset);
        if (kind === "invalid zlib") input[offset + 4] = 0;
        if (kind === "excess pixels") input[input.indexOf("columns=4") + 8] = 49;
        const bytes = kind === "truncated" ? input.subarray(0, input.length - 1) : input;
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.miff", bytes);
        await fs.writeFile("/out.png", Buffer.from("KEEP"));
        const args = ["in.miff", "PNG64:out.png"];
        const result = await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(1);
        expect(Buffer.from(await fs.readFile("/out.png")).toString()).toBe("KEEP");
        const files = new Map<string, Uint8Array>([["in.miff", bytes], ["out.png", Buffer.from("KEEP")]]);
        expect(runMagickCliSync(args, files).exitCode).toBe(1);
        expect(Buffer.from(files.get("out.png")!).toString()).toBe("KEEP");
    });
}

for (const compression of ["None", "Zip", "LZW"]) for (const mode of ["sync", "command"]) {
    it(`selects a compressed frame after ${compression} input in ${mode}`, async () => {
        const first = fixtures.find(fixture => fixture.depth === 8 && fixture.compression === compression)!;
        const second = fixtures.find(fixture => fixture.depth === 16 && fixture.compression === "Zip")!;
        const input = Buffer.concat([Buffer.from(first.bytes, "base64"), Buffer.from(second.bytes, "base64")]);
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["in.miff", input]]);
        await fs.writeFile("/in.miff", input);
        const args = ["in.miff[1]", "PNG64:out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        const output = mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png");
        const expected = Buffer.from(second.raw, "hex");
        expect([...decodeImage(output).data16!]).toEqual(Array.from({ length: 32 }, (_, index) => expected.readUInt16BE(index * 2)));
    });
}
