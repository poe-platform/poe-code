import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded RGBA16 samples.
const roundtrips = [
    [1, "202ba0abe0ebffff8077c0b74037808050621022f1024040908e201e403e0000"],
    [2, "2036a0b6e0f6ffff806ec0ae402e808050731033f1134040908c201c403c0000"],
    [8, "2078a0f8e138ffff8039c0793ff9808050dc109cf17c40409082201240320000"],
] as const;
const controls = [
    [["-alpha", "opaque", "-colorspace", "YUV", "-channel", "R", "-separate", "+channel", "-colorspace", "sRGB"], "819281928192ffff9edb9edb9edbffff3cfa3cfa3cfaffff456645664566ffff"],
    [["-alpha", "opaque", "-colorspace", "YUV", "-channel", "G", "-separate", "+channel", "-colorspace", "sRGB"], "aee7aee7aee7ffff516b516b516bffffd899d899d899ffff7d7a7d7a7d7affff"],
    [["-alpha", "opaque", "-colorspace", "YUV", "-channel", "B", "-separate", "+channel", "-colorspace", "sRGB"], "2a8c2a8c2a8cffff655665566556ffff910691069106ffffc1efc1efc1efffff"],
    [["-colorspace", "HSL", "-colorspace", "sRGB", "-colorspace", "HSL", "-colorspace", "sRGB"], "2020a0a0e0e0ffff8080c0c04040808050501010f0f040409090202040400000"],
] as const;

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const depth of ["uchar", "ushort"] as const) {
        it(`matches native YUV round trips and controls (${mode}, ${depth})`, async () => {
            const pixels = Uint8Array.of(32, 160, 224, 255, 128, 192, 64, 128, 80, 16, 240, 64, 144, 32, 64, 0);
            const input = encodeImage({ width: 4, height: 1, data: pixels,
                ...(depth === "ushort" ? { data16: Uint16Array.from(pixels, value => value * 257) } : {}),
                format: "png", space: "srgb", channels: 4, depth, density: 72, hasAlpha: true }, { format: "png" }).data;
            expect(decodeImage(input).depth).toBe(depth);
            const cases = [
                ...roundtrips.map(([count, expected]) => [Array.from({ length: count }, () => ["-colorspace", "YUV", "-colorspace", "sRGB"]).flat(), expected] as const),
                ...controls,
            ];
            for (const [operations, expected] of cases) {
                const files = new Map([["/in.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, data] of files) await fs.writeFile(path, data);
                const args = ["/in.png", ...operations, "PNG64:/out.png"];
                let stderr = "";
                const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async () => {} },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                });
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                expect(output.data16).toBeDefined();
                expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join(""), operations.join(" ")).toBe(expected);
            }
        });
    }
}
