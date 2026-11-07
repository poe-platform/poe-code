import fixtures from "./resize-depth-fixtures.json" with { type: "json" };
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PNG64 input with adjacent alpha samples 0x1234 and 0x1235.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAB3RJTUUH6gsHBzkcjsZcnAAAABRJREFUCNdjFDIJq5i1R8iEAQIYASDvArM+9YL1AAAAAElFTkSuQmCC", "base64");

for (const alpha of [false, true])
for (const operation of [["-sample"], ["-scale"], ["-resize"], ["-filter", "point", "-resize"]])
for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}, alpha=${alpha}: ${operation.join(" ")}: preserves exact 16-bit pixels when enlarging`, async () => {
        const a = [0x1234, 0x5678, 0x9abc, alpha ? 0x1234 : 0xffff];
        const b = [0x1235, 0x5678, 0x9abc, alpha ? 0x1235 : 0xffff];
        const source = encodeImage({ ...decodeImage(input), hasAlpha: alpha, channels: alpha ? 4 : 3,
            data: Uint8Array.from([...a, ...b], value => Math.round(value / 257)),
            data16: Uint16Array.from([...a, ...b]) }, { format: "png" }).data;
        const argv = ["in.png", ...operation, "4x2!", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", source);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...output.subarray(24, 26)]).toEqual([16, alpha ? 6 : 2]);
        const image = decodeImage(output);
        expect(image.width).toBe(4);
        expect(image.height).toBe(2);
        expect([...image.data16!]).toEqual([...a, ...a, ...b, ...b, ...a, ...a, ...b, ...b]);
    });
}

// ImageMagick 7 Q16-HDRI: -size 17x13 -depth 16 -endian MSB gray:-
// followed by each operation at 200%, output as 16-bit big-endian gray samples.
for (const operation of ["sample", "scale", "resize"] as const)
for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: ${operation} preserves the complete low-contrast gray16 grid`, async () => {
        const data16 = Uint16Array.from({ length: 17 * 13 * 4 }, (_, i) => {
            const pixel = Math.floor(i / 4);
            return i % 4 === 3 ? 65535 : 0x4210 + (pixel % 17 + 2 * Math.floor(pixel / 17)) % 19;
        });
        const source = encodeImage({ ...decodeImage(input), width: 17, height: 13,
            hasAlpha: false, channels: 1, data16, data: Uint8Array.from(data16, value => Math.round(value / 257))
        }, { format: "png" }).data;
        const argv = ["in.png", `-${operation}`, "200%", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", source);
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const image = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([34, 26]);
        const reference = Buffer.from(fixtures[operation], "base64");
        const expected = Array.from({ length: 34 * 26 }, (_, i) => {
            const value = reference.readUInt16BE(i * 2);
            return [value, value, value, 65535];
        }).flat();
        expect(Array.from(image.data16 ?? [])).toEqual(expected);
    });
}

// Native 4x3 RGB(A)16 input, varying red with constant non-byte-aligned G/B/A.
for (const alpha of [false, true])
for (const operation of ["scale", "resize"] as const)
for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: ${operation} retains RGB(A)16 precision when shrinking, alpha=${alpha}`, async () => {
        const data16 = Uint16Array.from(Array.from({ length: 12 }, (_, i) =>
            [60000 + i * 229, 0x2345, 0xabcd, alpha ? 0x98ab : 65535]).flat());
        const source = encodeImage({ ...decodeImage(input), width: 4, height: 3,
            hasAlpha: alpha, channels: alpha ? 4 : 3, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257))
        }, { format: "png" }).data;
        const argv = ["in.png", `-${operation}`, "3x2!", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", source);
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const image = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([3, 2]);
        expect(Array.from(image.data16 ?? [])).toEqual(fixtures[`${alpha ? "rgba" : "rgb"}_${operation}`]);
    });
}
