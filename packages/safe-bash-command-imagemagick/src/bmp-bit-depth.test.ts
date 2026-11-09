import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
  {
    "name": "info",
    "base64": "Qk1GAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA=="
  },
  {
    "name": "core",
    "base64": "Qk0qAAAAAAAAABoAAAAMAAAAAgACAAEAGAARIjNEVWYAAKq7zN3u/wAA"
  }
];

for (const fixture of fixtures) for (const bitDepth of [0, 2, 12, 24, 48]) for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`validates BMP bit depth ${bitDepth}: ${fixture.name} (${mode})`, async () => {
        const input = Buffer.from(fixture.base64, "base64"), keep = new TextEncoder().encode("keep");
        input.writeUInt16LE(bitDepth, fixture.name === "core" ? 24 : 28);
        const files = new Map<string, Uint8Array>([["/in.bmp", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.bmp", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.bmp", "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async (chunk) => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const valid = bitDepth === 24;
        expect(result.exitCode).toBe(valid ? 0 : 1);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (valid) {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([2, 2]);
            expect(Array.from(decoded.data)).toEqual([
                0xcc, 0xbb, 0xaa, 255, 0xff, 0xee, 0xdd, 255,
                0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255
            ]);
        } else {
            expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toContain("Unsupported BMP bits per pixel");
            expect(output).toEqual(keep);
        }
    });
}
