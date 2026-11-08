import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent Radiance reader, including planar RLE and legacy interleaved pixels.
function readRgbe(bytes: Uint8Array) {
    const buffer = Buffer.from(bytes);
    expect(buffer.subarray(0, 10).toString()).toBe("#?RADIANCE");
    const resolution = buffer.indexOf("-Y "), end = buffer.indexOf(10, resolution);
    const [, heightText, , widthText] = buffer.subarray(resolution, end).toString().split(" ");
    const width = Number(widthText), height = Number(heightText);
    let offset = end + 1;
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
        const row = new Uint8Array(width * 4);
        if (width >= 8 && width <= 32767 && buffer[offset] === 2 && buffer[offset + 1] === 2) {
            expect(buffer.readUInt16BE(offset + 2)).toBe(width); offset += 4;
            for (let channel = 0; channel < 4; channel++) {
                let x = 0;
                while (x < width) {
                    const count = buffer[offset++]!;
                    expect(count).toBeGreaterThan(0);
                    const run = count > 128, length = run ? count - 128 : count;
                    expect(x + length).toBeLessThanOrEqual(width);
                    const value = run ? buffer[offset++]! : 0;
                    for (let i = 0; i < length; i++) row[(x++) * 4 + channel] = run ? value : buffer[offset++]!;
                }
            }
        } else { row.set(buffer.subarray(offset, offset + row.length)); offset += row.length; }
        for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) pixels.push(row[x * 4 + c]! * 2 ** (row[x * 4 + 3]! - 136));
    }
    expect(offset).toBe(buffer.length);
    return { width, height, pixels };
}

const native = Buffer.from("Iz9SQURJQU5DRQpHQU1NQT0xClBSSU1BUklFUz0wIDAgMCAwIDAgMCAwIDAKRk9STUFUPTMyLWJpdF9ybGVfcmdiZQoKLVkgMiArWCA4CgICAAgIAAsQEA4uIi8IGC1CRT3AjcQIrcP07MYDDSoIe31+f4B/gIACAgAICH5RZv6audqACAADDTo1VoBaCLOf/Q0bQn1oCH+AgH+AgICB", "base64");
const input = Buffer.from("89504e470d0a1a0a0000000d4948445200000008000000020802000000eaf60aba0000001b4944415408d76364e0d21094d7c7442c1d3f2a047fe82321281700f30f0d9a8f67c0c40000000049454e44ae426082", "hex");
for (const mode of ["sync", "buffered", "retained"]) for (const destination of ["out.hdr", "HDR:out.bin", "hdr:-"]) for (const write of [false, true]) {
    it(`writes native RGBE values (${mode}, ${destination}, write=${write})`, async () => {
        const files = new Map<string, Uint8Array>([["input", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input", input);
        const args = ["input", ...(write ? ["-write", destination, "null:"] : [destination])];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const path = destination === "out.hdr" ? "out.hdr" : "out.bin";
        const output = destination === "hdr:-" ? result.stdoutBytes! : mode === "retained" ? await filesystem.readFile("/" + path) : files.get(path)!;
        expect(readRgbe(output)).toEqual(readRgbe(native));
    });
}
