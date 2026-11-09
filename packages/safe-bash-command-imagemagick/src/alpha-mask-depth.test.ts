import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint16Array.of(
    0x03e8, 0x59d8, 0x9c40, 0x0000,
    0x03e8, 0x59d8, 0x9c40, 0x0011,
    0x0fa0, 0x0fa0, 0x0fa0, 0x3a98,
    0xd903, 0xad9c, 0xea60, 0xffff
);
const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(pixels, value => Math.round(value / 257)), data16: pixels,
    format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: "ushort", density: 72
}, { format: "png", pngCoder: "png64" }).data;
// ImageMagick 7.1.2-35 Q16-HDRI output decoded as RGBA16; the first two pixels differ only in source alpha.
const mask = [0x4c5d, 0x4c5d, 0x0fa0, 0xbb3a];
const gray = (values: number[]) => values.flatMap(value => [value, value, value, 0xffff]);

for (const backend of ["command", "retained", "buffered", "sync"] as const) {
    for (const coder of ["", "PNG64"]) {
        it.each([
            { operations: ["-alpha", "extract"], expected: gray([0, 0x0011, 0x3a98, 0xffff]) },
            { operations: ["-alpha", "copy", "-alpha", "extract"], expected: gray(mask) },
            { operations: ["-alpha", "shape", "-alpha", "extract"], expected: gray(mask) },
            { operations: ["-background", "#123456789abc", "-alpha", "shape"], expected: mask.flatMap(alpha => [0x1234, 0x5678, 0x9abc, alpha]) },
            { operations: ["-alpha", "copy"], expected: Array.from(pixels, (value, index) => index % 4 === 3 ? coder === "PNG64" ? 0xffff : mask[Math.floor(index / 4)]! : value) }
        ])(`${backend}, ${coder || "PNG"}: preserves full precision for $operations`, async ({ operations, expected }) => {
            const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const argv = ["in.png", ...operations, `${coder ? coder + ":" : ""}out.png`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = backend === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : backend === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result, stderr).toMatchObject({ exitCode: 0 });
            const image = decodeImage(backend === "command" || backend === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(Array.from(image.data16 ?? Uint16Array.from(image.data, value => value * 257))).toEqual(expected);
        });
    }
}
