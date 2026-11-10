import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Full native ImageMagick 7.1.2-35 Q16-HDRI output, in file sample order.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["CMYK", "3x3+150%", "cmyk", "cc330000339933000033cc00"],
        ["CMYK", null, "cmyk", "ff00000000ff00000000ff00"],
        ["CMYK", "1x1+0", "cmyk", "ff00000000ff00000000ff00"],
        ["sRGB", "3x3+150%", "rgb", "33ccffcc66ccffcc33"],
    ] as const)(`${mode}: filters %s samples with %s`, async (space, geometry, format, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = ["xc:cyan", "xc:magenta", "xc:yellow", "+append", "-colorspace", space,
            ...(geometry === null ? [] : ["-mean-shift", geometry]), "-depth", "8", `${format}:out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it.each(["cmyka", "rgba"])(`keeps Q16 black separate from filtered alpha and updates %s (retained=${retained})`, async format => {
        const inputSamples = [65535, 0, 0, 12345, 0, 0, 65535, 0, 23456, 32768, 0, 0, 65535, 34567, 65535];
        const input = new Uint8Array(inputSamples.length * 2);
        inputSamples.forEach((sample, i) => new DataView(input.buffer).setUint16(i * 2, sample));
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const argv = ["-size", "3x1", "-depth", "16", "-endian", "MSB", "cmyka:input", "-mean-shift", "3x3+150%",
            ...(format === "rgba" ? ["-colorspace", "sRGB"] : []), `${format}:out`];
        const result = await runMagickCli(argv, retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = retained ? await fs.readFile("/out") : files.get("out")!;
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        expect(Array.from({ length: output.length / 2 }, (_, i) => view.getUint16(i * 2))).toEqual(format === "cmyka"
            ? [52428, 13107, 0, 12345, 19661, 13107, 39321, 13107, 23456, 45875, 0, 13107, 52428, 34567, 65535]
            : [10638, 42552, 53190, 19661, 33663, 16832, 33663, 45875, 30968, 24774, 6194, 65535]);
    });
}
