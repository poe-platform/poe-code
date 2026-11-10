import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from(Buffer.from("20a0e0ff80c040805010f04090204000", "hex"));
const mask = encodeImage({ width: 4, height: 1, data: Uint8Array.from([255, 0, 128, 32].flatMap(value => [value, value, value, 255])),
    format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: "uchar", density: 72
}, { format: "png" }).data;

// ImageMagick 7.1.2-35 Q16-HDRI PNG64 output, decoded as big-endian RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const deep of [false, true]) {
        it.each([
            { name: "solarize", before: [], operation: ["-solarize", "40%"], expected: "2020a0a0e0e0ffff7f7f3f3f40407f7f1bbc058c21a840400000000000000000" },
            { name: "negate", before: [], operation: ["-negate"], expected: "2020a0a0e0e0ffff7f7f3f3fbfbf7f7f7d219f19283640406f6fdfdfbfbf0000" },
            { name: "opaque solarize", before: ["-alpha", "opaque"], operation: ["-solarize", "40%"], expected: "2020a0a0e0e0ffff7f7f3f3f404000002850081078f1ffff122404080810ffff" },
            { name: "mask only", before: [], operation: [], expected: "2020a0a0e0e0ffff8080c0c04040808050501010f0f040409090202040400000" }
        ])(`${mode}, ${deep ? 16 : 8}-bit input retains fractional $name blends`, async ({ before, operation, expected }) => {
            const input = encodeImage({ width: 4, height: 1, data: pixels,
                ...(deep ? { data16: Uint16Array.from(pixels, value => value * 257) } : {}),
                format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: deep ? "ushort" : "uchar", density: 72
            }, { format: "png", pngCoder: deep ? "png64" : "png32" }).data;
            const files = new Map([["in.png", input], ["mask.png", mask], ["out.png", new TextEncoder().encode("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["in.png", ...before, "-write-mask", "mask.png", ...operation, "+write-mask", "PNG64:out.png"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result, stderr).toMatchObject({ exitCode: 0 });
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
        });
    }
}
