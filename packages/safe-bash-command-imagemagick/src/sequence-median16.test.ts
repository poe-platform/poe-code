import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI selects the middle tuple exactly, including alpha.
const low = [4608, 13315, 22032, 30720];
const middle = [4609, 13314, 22033, 30721];
const high = [4610, 13313, 22034, 30722];

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
    it.each([
        { name: "native low-bit reproduction", pixels: [low, middle, high], selected: middle },
        { name: "low-bit ranking in shuffled input", pixels: [middle, high, low], selected: middle },
        { name: "single input", pixels: [middle], selected: middle },
        { name: "upper median of an even sequence", pixels: [high, low], selected: high },
        { name: "stable intensity ties", pixels: [[1, 65535, 65534, 65533], [2, 65534, 65533, 65534], [3, 65533, 65532, 65535]], selected: [2, 65534, 65533, 65534] },
        { name: "full 18-bit sum range", pixels: [[65535, 65535, 65535, 65535], [0, 0, 0, 0], [65535, 65534, 65533, 65532]], selected: [65535, 65534, 65533, 65532] },
        { name: "mixed depth with 8-bit first input", pixels: [[257, 514, 771, 1028], high, middle], selected: middle, mixed: true },
        { name: "chunk boundary", pixels: [high, low, middle], selected: middle, width: 129 },
    ])(`${mode}: preserves Median tuples at source precision ($name)`, async ({ pixels, selected, mixed, width = 1 }) => {
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
        const args = [...pixels.map((_, index) => `/in${index}.png`), "-evaluate-sequence", "Median", "PNG64:/out.png"];
        const commandArgs = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: commandArgs.args, argumentValues: commandArgs,
            cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "filesystem" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, 1]);
        expect(Array.from(output.data16 ?? [])).toEqual(Array.from({ length: width }, () => selected).flat());
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI returns ef7f4359 for each case.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
it.each([
    { name: "out-of-range samples", before: ["-evaluate", "Multiply", "3"], after: ["-evaluate", "Divide", "3"], median: true },
    { name: "fractional samples", before: ["-evaluate", "Divide", "7"], after: ["-evaluate", "Multiply", "7"], median: true },
    { name: "unscaled control", before: [], after: [], median: true },
    { name: "scale round-trip control", before: ["-evaluate", "Multiply", "3"], after: ["-evaluate", "Divide", "3"], median: false },
])(`${mode}: retains the selected Median working pixel ($name)`, async ({ before, after, median }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    files.set("/out", new TextEncoder().encode("KEEP"));
    const inputs = (median ? ["xc:#ef7f4359", "xc:#9c5a27e1"] : ["xc:#ef7f4359"])
        .flatMap(input => ["(", input, ...before, ")"]);
    const argv = [...inputs, ...(median ? ["-evaluate-sequence", "Median"] : []), ...after, "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe("ef7f4359");
});
