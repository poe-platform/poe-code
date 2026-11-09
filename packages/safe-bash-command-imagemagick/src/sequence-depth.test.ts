import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const first = [10001, 23002, 30003, 40100];
const second = [10002, 23001, 30003, 40101];

for (const mode of ["sync", "map", "command"] as const)
it.each([
    { operation: "Threshold", expected: [65535, 0, 0, 65535] },
    { operation: "ThresholdBlack", expected: [10002, 0, 0, 40101] },
    { operation: "ThresholdWhite", expected: [65535, 23001, 30003, 65535] },
    { operation: "Xor", expected: [3, 3, 0, 1] },
    { operation: "And", expected: [10000, 23000, 30003, 40100] },
    { operation: "Or", expected: [10003, 23003, 30003, 40101] },
    { operation: "Max", expected: [10002, 23002, 30003, 40101] },
    { operation: "Min", expected: [10001, 23001, 30003, 40100] },
    { operation: "Set", expected: first },
    { operation: "Mean", expected: [10002, 23002, 30003, 40101] },
    // Native Q16-HDRI seeds RMS with the first unsquared sample.
    { operation: "RMS", expected: [7073, 16265, 21216, 28356] },
    { operation: "RootMeanSquare", expected: [7073, 16265, 21216, 28356] },
    { operation: "Add", expected: [20003, 46003, 60006, 65535] },
    { operation: "Sum", expected: [20003, 46003, 60006, 65535] },
    { operation: "Multiply", expected: [1526, 8073, 13736, 24537] },
    { operation: "LeftShift", pixels: [[1, 2, 0, 1], [3, 4, 5, 65535]], expected: [6, 16, 5, 65535] },
    { operation: "RightShift", pixels: [[1, 2, 0, 1], [3, 4, 5, 65535]], expected: [2, 1, 5, 32768] },
    { operation: "AddModulus", pixels: [[65535, 65534, 1, 40000], [1, 3, 65535, 40000]], expected: [0, 1, 0, 14464] },
    { operation: "Subtract", pixels: [[1, 30000, 500, 65535], [5, 20000, 1000, 65535]], expected: [4, 0, 500, 0] },
    { operation: "Divide", pixels: [[1, 2, 4, 65535], [12345, 30000, 16000, 65535]], expected: [12345, 15000, 4000, 1] },
    { operation: "Pow", pixels: [[1, 2, 0, 65535], [12345, 32768, 40000, 65535]], expected: [12345, 16384, 0, 65535] },
    { operation: "Xor", pixels: [[257, 514, 771, 1028], [258, 515, 772, 1029]], expected: [3, 1, 7, 1], mixed: true, width: 1025 },
    { operation: "Max", expected: first, single: true },
    { operation: "Min", expected: first, single: true },
    { operation: "Add", expected: first, single: true },
    { operation: "Multiply", expected: first, single: true },
    { operation: "Set", expected: first, single: true },
])(`${mode}: preserves 16-bit operands for $operation (single=$single)`, async ({ operation, expected, single, pixels = single ? [first] : [first, second], mixed = false, width = 1 }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const [index, pixel] of pixels.entries()) {
        const samples = Array.from({ length: width }, () => pixel).flat();
        const highDepth = !mixed || index !== 0;
        const bytes = encodeImage({ width, height: 1, format: "png", space: "srgb", channels: 4, density: 72, hasAlpha: true,
            depth: highDepth ? "ushort" : "uchar", data: Uint8Array.from(samples, value => Math.round(value / 257)),
            ...(highDepth ? { data16: Uint16Array.from(samples) } : {}) }, { format: "png" }).data;
        files.set(`/in${index}.png`, bytes);
        await fs.writeFile(`/in${index}.png`, bytes);
    }
    const args = [...files.keys(), "-evaluate-sequence", operation, "PNG64:/out.png"];
    const commandArgs = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: commandArgs.args, argumentValues: commandArgs,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
        : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([width, 1]);
    expect(Array.from(output.data16 ?? [])).toEqual(Array.from({ length: width }, () => expected).flat());
});
