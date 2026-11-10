import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

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
