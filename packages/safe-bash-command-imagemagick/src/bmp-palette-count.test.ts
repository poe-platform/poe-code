import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const bpp of [1, 4, 8]) for (const count of [0, 2 ** bpp, 2 ** bpp + 1]) {
    for (const mode of ["sync", "buffered", "command"] as const) {
        it(`validates a ${bpp}-bit BMP declaring ${count} colors (${mode})`, async () => {
            // Every declared entry is present; pixels reference only legal indices 0 and 1.
            const offset = 54 + (count || 2 ** bpp) * 4;
            const input = Buffer.alloc(offset + 4);
            input.write("BM");
            input.writeUInt32LE(input.length, 2);
            input.writeUInt32LE(offset, 10);
            input.writeUInt32LE(40, 14);
            input.writeInt32LE(2, 18);
            input.writeInt32LE(1, 22);
            input.writeUInt16LE(1, 26);
            input.writeUInt16LE(bpp, 28);
            input.writeUInt32LE(4, 34);
            input.writeUInt32LE(count, 46);
            input.set([0x11, 0x22, 0x33, 0, 0x44, 0x55, 0x66, 0], 54);
            input.set(bpp === 8 ? [0, 1] : [bpp === 4 ? 0x01 : 0x40], offset);
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
            const valid = count <= 2 ** bpp;
            expect(result.exitCode).toBe(valid ? 0 : 1);
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            if (valid) expect(Array.from(decodeImage(output).data)).toEqual([0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255]);
            else expect(Array.from(output)).toEqual(Array.from(keep));
        });
    }
}
