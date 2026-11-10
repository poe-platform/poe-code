import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

const pixels = Buffer.from("1234abcdff0080ff1234abcd55660080".repeat(2), "hex");
const inputs = {
    png: encodeImage({ width: 4, height: 2, data: pixels, format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data,
    miff: Buffer.concat([
        Buffer.from("id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=4 rows=2 depth=8\ncolorspace=sRGB\ncompression=None\n\f\n:\x1a"),
        pixels,
    ]),
};

// Native ImageMagick 7.1.2-35 Q16-HDRI bytes, including RGB at zero alpha.
const cases = [
    { input: "png", options: ["-channel", "A", "-negate", "+channel", "-depth", "8"], target: "rgba:out.raw", hex: "1234ab32ff0080001234ab325566007f" },
    { input: "png", options: ["-negate", "-depth", "8"], target: "rgba:out.raw", hex: "edcb543200ff7f00edcb5432aa99ff7f" },
    { input: "png", options: ["-alpha", "opaque", "-negate", "-depth", "8"], target: "rgba:out.raw", hex: "edcb540000ff7f00edcb5400aa99ff00" },
    { input: "miff", options: ["-negate", "-depth", "8"], target: "rgba:out.raw", hex: "edcb543200ff7f00edcb5432aa99ff7f" },
    { input: "png", options: ["-channel", "A", "-negate", "+channel"], target: "PNG64:out.png", hex: "12123434abab3232ffff00008080000012123434abab32325555666600007f7f" },
    { input: "png", options: ["-negate"], target: "PNG64:out.png", hex: "ededcbcb545432320000ffff7f7f0000ededcbcb54543232aaaa9999ffff7f7f" },
    { input: "png", options: ["-negate", "-alpha", "off", "-depth", "8"], target: "rgba:out.raw", hex: "edcb54ff00ff7fffedcb54ffaa99ffff" },
    { input: "png", options: ["-channel", "RGB", "-negate", "+channel", "-depth", "8"], target: "rgba:out.raw", hex: "edcb54cd00ff7fffedcb54cdaa99ff80" },
] as const;

for (const { input, options, target, hex } of cases) {
    it(`preserves color samples: ${input} ${options.join(" ")} ${target}`, async () => {
        const fs = new MemoryFileSystem(), errors: Uint8Array[] = [];
        const outputPath = "/" + target.split(":")[1]!;
        await fs.writeFile(`/in.${input}`, inputs[input]);
        await fs.writeFile(outputPath, new TextEncoder().encode("KEEP"));
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments([`in.${input}`, ...options, target]).args,
            cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } },
        });
        expect(Buffer.concat(errors).toString()).toBe("");
        expect(result.exitCode).toBe(0);
        let bytes = await fs.readFile(outputPath);
        if (target.startsWith("PNG64:")) {
            const decoded = decodeImage(bytes);
            expect([decoded.width, decoded.height, decoded.depth]).toEqual([4, 2, "ushort"]);
            expect(decoded.data16).toBeDefined();
            const samples = decoded.data16!;
            bytes = new Uint8Array(samples.length * 2);
            const view = new DataView(bytes.buffer);
            samples.forEach((value, index) => view.setUint16(index * 2, value));
        }
        expect(Buffer.from(bytes).toString("hex")).toBe(hex.repeat(2));
    });
}
