import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
  {
    "name": "trunc",
    "base64": "Qk0/AAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACq"
  },
  {
    "name": "onerow",
    "base64": "Qk0+AAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAAA="
  },
  {
    "name": "none",
    "base64": "Qk02AAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  },
  {
    "name": "nopad",
    "base64": "Qk1EAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8="
  },
  {
    "name": "ok",
    "base64": "Qk1GAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA=="
  },
  {
    "name": "top",
    "base64": "Qk1GAAAAAAAAADYAAAAoAAAAAgAAAP7///8BABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA=="
  }
];

for (const fixture of fixtures) for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`validates complete padded BMP rows: ${fixture.name} (${mode})`, async () => {
        const input = Buffer.from(fixture.base64, "base64"), keep = new TextEncoder().encode("keep");
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
        const valid = fixture.name === "ok" || fixture.name === "top";
        expect(result.exitCode).toBe(valid ? 0 : 1);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (valid) {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([2, 2]);
            const rows = [[0xcc, 0xbb, 0xaa, 255, 0xff, 0xee, 0xdd, 255], [0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255]];
            expect(Array.from(decoded.data)).toEqual((fixture.name === "top" ? rows.reverse() : rows).flat());
        } else expect(output).toEqual(keep);
    });
}
