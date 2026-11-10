import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import fixtures from "./miff-lzma-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: -size 4x2 -depth <8|16> -endian MSB
// rgba:<samples> -depth <8|16> -compress <None|LZMA> miff:-.
const high = "010104018001ffff".repeat(3) + "0000fffe02bc7530" + "11121edd535ed903".repeat(4);
const flopped = "0000fffe02bc7530" + "010104018001ffff".repeat(3) + "11121edd535ed903".repeat(4);
const low = "1234abcdff0080ff1234abcd55660080".repeat(2);

for (const mode of ["command", "sync"] as const) for (const compression of ["None", "LZMA"] as const) {
    it.each([
        [16, [], "PNG64", high],
        [16, ["-flop"], "PNG64", flopped],
        [8, ["-depth", "8"], "rgba", low]
    ] as [8 | 16, string[], string, string][])(`${mode} reads ${compression} %i-bit MIFF %j`, async (depth, options, coder, expected) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["in.miff", Buffer.from(fixtures[`${compression}${depth}`], "base64")], ["out.bin", Buffer.from("KEEP")]]);
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = ["in.miff", ...options, `${coder}:out.bin`];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("out.bin")! : await fs.readFile("/out.bin");
        const expectedBytes = Buffer.from(expected, "hex");
        if (coder === "PNG64") expect([...decodeImage(output).data16!]).toEqual(Array.from({ length: expectedBytes.length / 2 }, (_, i) => expectedBytes.readUInt16BE(i * 2)));
        else expect(Buffer.from(output)).toEqual(expectedBytes);
    });
}

for (const mode of ["command", "sync"] as const) it.each(["truncated", "corrupt"])(`${mode} preserves the destination for %s LZMA input`, async damage => {
    const input = Buffer.from(fixtures.LZMA16, "base64");
    if (damage === "corrupt") { const offset = input.indexOf(Buffer.from([0xfd, 0x37, 0x7a, 0x58])) + 40; input[offset] = input[offset]! ^ 255; }
    const bytes = damage === "truncated" ? input.subarray(0, -1) : input;
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["in.miff", bytes], ["out.png", Buffer.from("KEEP")]]);
    for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
    const args = ["in.miff", "PNG64:out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(1);
    expect(Buffer.from(mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png")).toString()).toBe("KEEP");
});
