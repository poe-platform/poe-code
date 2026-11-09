import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const bpp of [1, 4, 8]) for (const rle of bpp === 1 ? [false] : [false, true]) {
    for (const valid of [false, true]) for (const mode of ["sync", "buffered", "command"] as const) {
        it(`${valid ? "decodes" : "rejects"} ${bpp}-bit palette indices, RLE=${rle} (${mode})`, async () => {
            const input = Buffer.from("424d42000000000000003e00000028000000020000000100000001000800000000000400000000000000000000000200000000000000112233004455660000010000", "hex");
            input.writeUInt16LE(bpp, 28);
            input.writeUInt32LE(bpp === 1 && !valid ? 1 : 2, 46);
            if (rle) {
                input.writeUInt32LE(bpp === 8 ? 1 : 2, 30);
                input.set([2, valid ? 1 : 2, 0, 1], 62);
                if (bpp === 4) input[63] = valid ? 0x01 : 0x12;
            } else input.set(bpp === 8 ? valid ? [0, 1] : [1, 2] : [bpp === 1 ? 0x40 : valid ? 0x01 : 0x12, 0], 62);
            const keep = Buffer.from("keep"), fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>([["/in.bmp", input], ["/out.png", keep]]);
            await fs.writeFile("/in.bmp", input);
            await fs.writeFile("/out.png", keep);
            const args = ["/in.bmp", "/out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} }
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result.exitCode).toBe(valid ? 0 : 1);
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            if (valid) expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(rle && bpp === 8 ? "665544ff665544ff" : "332211ff665544ff");
            else expect(Array.from(output)).toEqual(Array.from(keep));
        });
    }
}
