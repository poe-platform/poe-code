import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Opaque RGB8 inputs and PNG24 results from ImageMagick 7.1.2-35 Q16-HDRI.
const inputs = [
    [200, 240, 20, 240, 20, 51, 20, 51, 200, 51, 200, 240],
    [100, 60, 140, 60, 140, 241, 140, 241, 100, 241, 100, 60],
];
const cases = [
    { operation: "Multiply", after: [], expected: "4e380b380b300b304e304e38" },
    { operation: "Multiply", after: ["-evaluate", "Divide", "2"], expected: "271c051c051805182718271c" },
    { operation: "RMS", after: [], expected: "472a632a63aa63aa47aa472a" },
    { operation: "RMS", after: ["-evaluate", "Divide", "2"], expected: "231531153155315523552315" },
    { operation: "RootMeanSquare", after: ["-evaluate", "Divide", "2"], expected: "231531153155315523552315" },
    { operation: "Multiply", before: ["-evaluate", "Divide", "2"], after: ["-evaluate", "Multiply", "4"], expected: "4e380b380b300b304e304e38" },
];

for (const mode of ["command", "retained", "map", "sync"] as const)
for (const depth of [8, 16] as const)
for (const width of [4, 2052])
it.each(cases)(`${mode}: preserves $operation fractions before $after (depth=${depth}, width=${width}, before=$before)`, async ({ operation, before = [], after, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (const [index, samples] of inputs.entries()) {
        const data = Uint8Array.from({ length: width * 4 }, (_, offset) => offset % 4 === 3 ? 255 : samples[(Math.floor(offset / 4) % 4) * 3 + offset % 4]!);
        const bytes = encodeImage({ width, height: 1, format: "png", space: "srgb", channels: 3, density: 72, hasAlpha: false,
            depth: depth === 16 ? "ushort" : "uchar", data,
            ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {}) }, { format: "png" }).data;
        files.set(`/in${index}.png`, bytes);
        await fs.writeFile(`/in${index}.png`, bytes);
    }
    const args = ["/in0.png", "/in1.png", ...before, "-evaluate-sequence", operation, ...after, "PNG24:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([width, 1]);
    expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(expected.repeat(width / 4));
});
