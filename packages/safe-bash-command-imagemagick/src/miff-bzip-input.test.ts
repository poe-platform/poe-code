import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import fixtures from "./miff-bzip-input-fixtures.json" with { type: "json" };

// Native ImageMagick: 4x2 big-endian RGBA input, -compress None/BZip miff:-.
for (const fixture of fixtures) for (const flop of [false, true]) for (const mode of ["command", "sync"]) {
    it(`reads ${fixture.compression} RGBA${fixture.depth}, flop=${flop}, ${mode}`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixture.bytes, "base64"));
        const fs = new MemoryFileSystem(), files = new Map([["in.miff", bytes], ["out", new TextEncoder().encode("KEEP")]]);
        await fs.writeFile("/in.miff", bytes); await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const args = ["in.miff", ...(flop ? ["-flop"] : []), ...(fixture.depth === 8 ? ["-depth", "8", "rgba:out"] : ["PNG64:out"])];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const raw = Buffer.from(fixture.rgba, "hex"), pixelBytes = fixture.depth / 2;
        const expected = Buffer.concat(Array.from({ length: 8 }, (_, pixel) => {
            const source = flop ? Math.floor(pixel / 4) * 4 + 3 - pixel % 4 : pixel;
            return raw.subarray(source * pixelBytes, (source + 1) * pixelBytes);
        }));
        const output = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (fixture.depth === 8) expect(Buffer.from(output)).toEqual(expected);
        else expect([...decodeImage(output).data16!]).toEqual(Array.from({ length: 32 }, (_, i) => expected.readUInt16BE(i * 2)));
    });
}

it.each(["truncated", "checksum", "packet", "excess"])("rejects %s BZip input without replacing the destination", async damage => {
    let bytes = new Uint8Array(Buffer.from(fixtures.find(fixture => fixture.compression === "BZip")!.bytes, "base64"));
    const offset = bytes.indexOf(26) + 1;
    if (damage === "truncated") bytes = bytes.slice(0, -1);
    if (damage === "checksum") bytes[offset + 14] = bytes[offset + 14]! ^ 255;
    if (damage === "packet") new DataView(bytes.buffer).setUint32(offset, 0xffffffff);
    if (damage === "excess") {
        const text = new TextDecoder().decode(bytes.subarray(0, offset)).replace("columns=4", "columns=3");
        bytes.set(new TextEncoder().encode(text));
    }
    const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("KEEP");
    await fs.writeFile("/in.miff", bytes); await fs.writeFile("/out.png", keep);
    const result = await createMagickCommand().execute({
        command: "magick", args: ["in.miff", "PNG64:out.png"], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(1);
    expect(await fs.readFile("/out.png")).toEqual(keep);
});
