import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
    { name: "exact", size: 70, imageSize: 16 },
    { name: "zero", size: 0, imageSize: 16 },
    { name: "small", size: 54, imageSize: 16 },
    { name: "large", size: 80, imageSize: 16 },
    { name: "zero image size", size: 70, imageSize: 0 }
];

for (const fixture of fixtures) for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`validates BMP file size: ${fixture.name} (${mode})`, async () => {
        const input = Buffer.from("Qk1GAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA==", "base64"), keep = new TextEncoder().encode("keep");
        input.writeUInt32LE(fixture.size, 2);
        input.writeUInt32LE(fixture.imageSize, 34);
        const files = new Map<string, Uint8Array>([["/in.bmp", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.bmp", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const valid = fixture.size === input.length;
        expect(result.exitCode).toBe(valid ? 0 : 1);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (valid) {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([2, 2]);
            const rows = [[0xcc, 0xbb, 0xaa, 255, 0xff, 0xee, 0xdd, 255], [0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255]];
            expect(Array.from(decoded.data)).toEqual(rows.flat());
        } else expect(output).toEqual(keep);
    });
}
