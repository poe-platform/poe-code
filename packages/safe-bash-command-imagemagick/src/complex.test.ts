import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    {
        name: "subtract with alpha only in the first real operand",
        inputs: ["#40608040", "#102030", "#204060", "#081018"],
        operation: ["-complex", "Subtract"],
        expected: ["2020202020204040", "080810101818ffff"],
    },
    {
        name: "add with alpha only in the first real operand",
        inputs: ["#40608040", "#102030", "#204060", "#081018"],
        operation: ["-complex", "Add"],
        expected: ["6060a0a0e0e04040", "181830304848ffff"],
    },
    {
        name: "subtract with alpha only in the first imaginary operand",
        inputs: ["#406080", "#10203080", "#204060", "#081018"],
        operation: ["-complex", "Subtract"],
        expected: ["202020202020ffff", "0808101018188080"],
    },
    {
        name: "add with alpha in both pairs",
        inputs: ["#40608040", "#10203080", "#20406010", "#08101820"],
        operation: ["-channel", "All", "-complex", "Add"],
        expected: ["6060a0a0e0e05050", "181830304848a0a0"],
    },
    {
        name: "subtract with alpha only in the second real operand",
        inputs: ["#406080", "#102030", "#20406010", "#081018"],
        operation: ["-complex", "Subtract"],
        expected: ["202020202020ffff", "080810101818ffff"],
    },
])(`${mode}: complex $name`, async ({ inputs, operation, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`, seed = new TextEncoder().encode("KEEP");
        files.set(path, seed);
        await fs.writeFile(path, seed);
    }
    const argv = [...inputs.map(color => `xc:${color}`), ...operation, "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    for (const [index, pixels] of expected.entries()) {
        const path = `/r-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(pixels);
    }
});

for (const mode of ["buffered", "sync", "retained", "command"])
for (const operation of ["Add", "Subtract"])
it(`${mode}: complex ${operation} writes real then imaginary`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["-size", "1x1", "xc:#330000", "xc:#003300", "xc:#110000", "xc:#001100",
        "-complex", operation, "+adjoin", "PNG24:/n-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const value = operation === "Add" ? 0x44 : 0x22;
    for (const [index, expected] of [[value, 0, 0, 255], [0, value, 0, 255]].entries()) {
        const path = `/n-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect([...output.data]).toEqual(expected);
    }
});

for (const retained of [false, true]) {
    it(`complex arithmetic preserves negative intermediate samples (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1x1", "xc:#110000", "xc:#001100", "xc:#330000", "xc:#003300",
            "-complex", "Subtract", "xc:#330000", "xc:#003300", "-complex", "Add", "+adjoin", "PNG24:/n-%d.png"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const [index, expected] of [[17, 0, 0, 255], [0, 17, 0, 255]].entries()) {
            const path = `/n-${index}.png`;
            expect([...decodeImage(retained ? await fs.readFile(path) : files.get(path)!).data]).toEqual(expected);
        }
    });

    it(`complex uses the first pair again when no second pair exists (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1x1", "xc:#330000", "xc:#003300", "-complex", "Add", "+adjoin", "PNG24:/n-%d.png"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const [index, expected] of [[102, 0, 0, 255], [0, 102, 0, 255]].entries()) {
            const path = `/n-${index}.png`;
            expect([...decodeImage(retained ? await fs.readFile(path) : files.get(path)!).data]).toEqual(expected);
        }
    });

    for (const [args, error] of [
        [["xc:red", "-complex", "Add"], "image sequence is required"],
        [["xc:red", "xc:green", "-complex", "Bogus"], "unsupported complex operator"],
        [["xc:red", "xc:green", "-complex"], "missing argument"],
    ] as const)
    it(`complex rejects ${error} (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli([...args, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        if (retained) await expect(fs.readFile("/out.png")).rejects.toThrow();
        else expect(files.has("/out.png")).toBe(false);
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI decoded RGBA16 samples.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const [name, inputs, operation, expected] of [
    ["gray second real", ["xc:#406080", "xc:#102030", "(", "xc:#204060", "-colorspace", "Gray", ")", "xc:#081018"], "Add",
        [[0x7bfd, 0x6060, 0x8080, 0xffff], [0x1818, 0x2020, 0x3030, 0xffff]]],
    ["gray first real", ["(", "xc:#406080", "-colorspace", "Gray", ")", "xc:#102030", "xc:#204060", "xc:#081018"], "Add",
        [[0x7bfd, 0x7bfd, 0x7bfd, 0xffff], [0x1818, 0x2020, 0x3030, 0xffff]]],
    ["gray first imaginary", ["xc:#406080", "(", "xc:#102030", "-colorspace", "Gray", ")", "xc:#204060", "xc:#081018"], "Subtract",
        [[0x2020, 0x6060, 0x8080, 0xffff], [0x15d6, 0x15d6, 0x15d6, 0xffff]]],
    ["gray second imaginary", ["xc:#406080", "xc:#102030", "xc:#204060", "(", "xc:#081018", "-colorspace", "Gray", ")"], "Add",
        [[0x6060, 0x6060, 0x8080, 0xffff], [0x1eff, 0x2020, 0x3030, 0xffff]]],
    ["all gray", ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018", "-colorspace", "Gray"], "Add",
        [[0x979a, 0x979a, 0x979a, 0xffff], [0x2cce, 0x2cce, 0x2cce, 0xffff]]],
    ["all sRGB", ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018", "-colorspace", "sRGB"], "Add",
        [[0x6060, 0xa0a0, 0xe0e0, 0xffff], [0x1818, 0x3030, 0x4848, 0xffff]]]
] as const)
it(`${mode}: complex preserves channel availability with ${name}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (let index = 0; index < 2; index++) {
        const path = `/r-${index}.png`, original = new TextEncoder().encode("KEEP");
        files.set(path, original);
        await fs.writeFile(path, original);
    }
    const argv = [...inputs, "-complex", operation, "-colorspace", "sRGB", "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    for (const [index, samples] of expected.entries()) {
        const path = `/r-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect([...output.data16!]).toEqual(samples);
    }
});

// Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const [inputs, operation, expected] of [
    [["xc:#406080", "xc:#102030"], "MagnitudePhase", [[0x423a, 0x6597, 0x893d, 0xffff], [0x89fb, 0x8d1b, 0x8e9e, 0xffff]]],
    [["xc:#4080c0", "xc:#80a060"], "MagnitudePhase", [[0x8fab, 0xcdb3, 0xd780, 0xffff], [0xad1b, 0xa482, 0x92e3, 0xffff]]],
    [["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"], "MagnitudePhase", [[0x423a, 0x6597, 0x893d, 0xffff], [0x89fb, 0x8d1b, 0x8e9e, 0xffff]]],
    [["xc:#406080", "xc:#102030"], "Add", [[0x8080, 0xc0c0, 0xffff, 0xffff], [0x2020, 0x4040, 0x6060, 0xffff]]],
    [["xc:#406080", "xc:#102030"], "Bogus", []]
] as const)
it(`${mode}: complex ${operation} matches native for ${inputs.join(" ")}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("KEEP");
    for (let index = 0; index < 2; index++) {
        files.set(`/r-${index}.png`, original);
        await fs.writeFile(`/r-${index}.png`, original);
    }
    const argv = [...inputs, "-complex", operation, "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(operation === "Bogus" ? 1 : 0);
    for (let index = 0; index < 2; index++) {
        const path = `/r-${index}.png`;
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (operation === "Bogus") expect(bytes).toEqual(original);
        else {
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([1, 1]);
            expect([...output.data16!]).toEqual(expected[index]);
        }
    }
});

// Native ImageMagick 7.1.2-35 Q16-HDRI decoded RGBA16 samples.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const [name, inputs, operations, expected] of [
    ["polar conversion", ["xc:#4080c0", "xc:#80a060"], ["-complex", "RealImaginary"],
        [[0x403f, 0x5974, 0x898c, 0xffff], [0x00cb, 0x5c40, 0, 0xffff]]],
    ["negative working values and extra pair", ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"],
        ["-complex", "RealImaginary", "-evaluate", "multiply", "0.5", "-evaluate", "add", "25%"],
        [[0x2257, 0x1e08, 0x27b0, 0xffff], [0x33a9, 0x1dd2, 0x0487, 0xffff]]],
    ["polar round trip", ["xc:#406080", "xc:#102030"], ["-complex", "MagnitudePhase", "-complex", "RealImaginary"],
        [[0x4040, 0x6060, 0x8080, 0xffff], [0x1010, 0x2020, 0x3030, 0xffff]]],
    ["subtract control", ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"], ["-complex", "Subtract"],
        [[0x2020, 0x2020, 0x2020, 0xffff], [0x0808, 0x1010, 0x1818, 0xffff]]],
    ["invalid control", ["xc:#406080", "xc:#102030"], ["-complex", "Bogus"], []]
] as const)
it(`${mode}: complex ${name}`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("KEEP");
    for (let index = 0; index < 2; index++) {
        files.set(`/r-${index}.png`, original);
        await fs.writeFile(`/r-${index}.png`, original);
    }
    const argv = [...inputs, ...operations, "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(expected.length ? 0 : 1);
    for (let index = 0; index < 2; index++) {
        const path = `/r-${index}.png`;
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (!expected.length) expect(bytes).toEqual(original);
        else {
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([1, 1]);
            expect([...output.data16!]).toEqual(expected[index]);
        }
    }
});
