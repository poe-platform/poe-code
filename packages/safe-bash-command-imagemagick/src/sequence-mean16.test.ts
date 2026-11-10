import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem"])
for (const resized of [false, true])
for (const mixed of [false, true])
for (const reverse of [false, true])
it(`retains sequence Mean quantum precision (${mode}, resized=${resized}, mixed=${mixed}, reverse=${reverse})`, async () => {
    const first = [0x4001, 0x8002, 0x8003, 65535];
    const second = mixed ? [0x6060, 0x9090, 0x9090, 65535] : [0x6043, 0x9024, 0x9025, 65535];
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    for (const [index, pixel] of [first, second].entries()) {
        const size = resized && index === 1 ? 3 : 1;
        const samples = Array.from({ length: size * size }, () => pixel).flat();
        const highDepth = !mixed || index === 0;
        const bytes = encodeImage({ width: size, height: size, format: "png", space: "srgb", channels: 3, density: 72, hasAlpha: false,
            depth: highDepth ? "ushort" : "uchar", data: Uint8Array.from(samples, value => Math.round(value / 257)),
            ...(highDepth ? { data16: Uint16Array.from(samples) } : {}) }, { format: "png" }).data;
        files.set(`/in${index}.png`, bytes);
        await filesystem.writeFile(`/in${index}.png`, bytes);
    }
    for (const keepFirst of [false, true]) {
        const inputs = keepFirst ? ["/in0.png"] : reverse ? ["/in1.png", "/in0.png"] : ["/in0.png", "/in1.png"];
        const args = [...inputs, "-evaluate-sequence", "Mean", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "filesystem" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const size = resized && !keepFirst ? 3 : 1;
        expect([output.width, output.height]).toEqual([size, size]);
        // Native Q16-HDRI: the reported mean pixel is 5022 8813 8814 ffff.
        const expected = keepFirst ? first : first.map((value, channel) => Math.round((value + second[channel]!) / 2));
        expect(Array.from(output.data16 ?? [])).toEqual(Array.from({ length: size * size }, () => expected).flat());
    }
});

it("preserves the native PNG48 reproduction through the public magick command", async () => {
    const fs = new MemoryFileSystem();
    // magick -size 1x1 xc:<color> -depth 16 -strip PNG48:-
    const inputs = [
        "89504e470d0a1a0a0000000d4948445200000001000000011002000000c0e78f9d0000000f4944415408d76370606c606a60060004950147f910a8230000000049454e44ae426082",
        "89504e470d0a1a0a0000000d4948445200000001000000011002000000c0e78f9d0000000f4944415408d76348709ea0324115000787020d33c5fa2d0000000049454e44ae426082"
    ];
    for (const [index, hex] of inputs.entries()) await fs.writeFile(`/deep${index}.png`, Buffer.from(hex, "hex"));
    const args = createCommandArguments(["/deep0.png", "/deep1.png", "-evaluate-sequence", "Mean", "/out.png"]);
    const result = await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png"));
    expect(Array.from(output.data16!)).toEqual([0x5022, 0x8813, 0x8814, 65535]);
    expect(Array.from(output.data)).toEqual([0x50, 0x88, 0x88, 0xff]);
});

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGBA results.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
it.each([
    { name: "16-bit output", before: [], reducer: ["-evaluate-sequence", "Mean"], after: ["-depth", "16", "-endian", "MSB"], expected: "c6466ced35359d9d" },
    { name: "multiply fractional mean", before: [], reducer: ["-evaluate-sequence", "Mean"], after: ["-evaluate", "Multiply", "2", "-depth", "8"], expected: "ffd96aff" },
    { name: "8-bit output control", before: [], reducer: ["-evaluate-sequence", "Mean"], after: ["-depth", "8"], expected: "c66d359d" },
    { name: "average alias", before: [], reducer: ["-average"], after: ["-depth", "16", "-endian", "MSB"], expected: "c6466ced35359d9d" },
    { name: "out-of-range operands", before: ["-evaluate", "Multiply", "3"], reducer: ["-evaluate-sequence", "Mean"], after: ["-evaluate", "Divide", "3", "-depth", "8"], expected: "c66d359d" },
    { name: "fractional operands", before: ["-evaluate", "Divide", "7"], reducer: ["-evaluate-sequence", "Mean"], after: ["-evaluate", "Multiply", "7", "-depth", "8"], expected: "c66d359d" },
])(`${mode}: retains Mean working samples from 8-bit literals ($name)`, async ({ before, reducer, after, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    files.set("/out", new TextEncoder().encode("KEEP"));
    const inputs = ["xc:#ef7f4359", "xc:#9c5a27e1"].flatMap(input => before.length ? ["(", input, ...before, ")"] : [input]);
    const argv = [...inputs, ...reducer, ...after, "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
