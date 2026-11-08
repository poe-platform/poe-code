import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCliSync } from "./index.js";

for (const mode of ["magick", "convert", "sync"] as const) {
    it.each([
        { color: "#00ff00", border: [0, 255, 0, 255], center: [128, 127, 0, 255] },
        { color: "#00ff0080", border: [0, 255, 0, 128], center: [170, 85, 0, 192] },
        { color: "#00ff0000", border: [0, 255, 0, 0], center: [255, 0, 0, 128] },
    ])(`${mode}: composites translucent source over $color`, async ({ color, border, center }) => {
        const bytes = await sharp(Uint8Array.of(255, 0, 0, 128), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const args = createCommandArguments(["png:-", "-bordercolor", color, "-border", "1x2", "png:-"]);
        let output: Uint8Array;
        if (mode === "sync") {
            const result = runConvertCliSync(args.args, new Map(), bytes);
            expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
            output = result.stdoutBytes!;
        } else {
            const command = mode === "magick" ? createMagickCommand() : createConvertCommand();
            const chunks: number[] = [];
            let stderr = "";
            const result = await command.execute({
                command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () { yield bytes; })(),
                stdout: { async write(chunk) { chunks.push(...chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
            output = Uint8Array.from(chunks);
        }
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([3, 5]);
        for (let pixel = 0; pixel < 15; pixel++) {
            expect(Array.from(image.data.subarray(pixel * 4, pixel * 4 + 4))).toEqual(pixel === 7 ? center : border);
        }
    });
}
