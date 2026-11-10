import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inks = [25, 80, 200, 10, 200, 31, 0, 150, 60, 128, 220, 201, 0, 0, 0, 255, 254, 253, 252, 1];
const cmyk = new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), ...inks]);
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const rgba = new Uint8Array(header.length + 40);
rgba.set(header);
[61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767, 50000, 16000, 38000, 32768, 0, 11000, 65535, 65535]
    .forEach((value, index) => new DataView(rgba.buffer).setUint16(header.length + index * 2, value));

// ImageMagick 7.1.2-35 Q16-HDRI: CMY samples become RGB, without ink conversion.
const methods = [
    { operation: ["-threshold", "50%"], white: [0, 0, 0, 0, 1], threshold: "" },
    { operation: ["-auto-threshold", "OTSU"], white: [0, 0, 1, 0, 1], threshold: "47.0588%" },
    { operation: ["-auto-threshold", "Kapur"], white: [1, 0, 1, 0, 1], threshold: "25.4902%" },
    { operation: ["-auto-threshold", "Triangle"], white: [1, 1, 1, 0, 1], threshold: "0.392157%" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    async function run(input: Uint8Array, options: string[], output: string) {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pam", input], ["out", sentinel]]);
        const fs = new MemoryFileSystem();
        for (const [name, data] of files) await fs.writeFile(`/${name}`, data);
        const argv = ["in.pam", ...options, output];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        return mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    }

    for (const { operation, white, threshold } of methods) {
        for (const red of [false, true]) {
            it(`${mode}: ${operation.join(" ")} ${red ? "red channel" : "default channels"} replaces CMYK with sRGB`, async () => {
                const options = [...(red ? ["-channel", "R"] : []), ...operation, "+channel"];
                const output = await run(cmyk, [...options, "-format", `%[colorspace] %[fx:p{1,0}.r] %[fx:p{1,0}.k]${threshold ? " %[auto-threshold:threshold]" : ""}`], "info:out");
                const value = red ? 1 : white[1];
                expect(new TextDecoder().decode(output)).toBe(`sRGB ${value} ${value}${threshold ? ` ${threshold}` : ""}`);
                const pixels = await run(cmyk, [...options, "-colorspace", "sRGB"], "PNG64:out");
                const redWhite = operation[1] === "Triangle" ? [1, 1, 1, 0, 1] : [0, 1, 0, 0, 1];
                const expected = white.flatMap((value, index) => red
                    ? [redWhite[index]! * 65535, inks[index * 4 + 1]! * 257, inks[index * 4 + 2]! * 257, 65535]
                    : [value * 65535, value * 65535, value * 65535, 65535]);
                expect([...decodeImage(pixels).data16!]).toEqual(expected);
            });
        }
    }

    it(`${mode}: preserves untouched CMYK samples`, async () => {
        const output = await run(cmyk, ["-format", "%[colorspace] %[fx:p{1,0}.r] %[fx:p{1,0}.k]"], "info:out");
        expect(new TextDecoder().decode(output)).toBe("CMYK 0.784314 0.588235");
    });

    it.each([
        ["-black-threshold", "50%"],
        ["-white-threshold", "50%"],
        ["-range-threshold", "10,30,60,90%"],
    ])(`${mode}: keeps CMYK colorspace for %s`, async (operator, argument) => {
        const output = await run(cmyk, [operator, argument, "-format", "%[colorspace]"], "info:out");
        expect(new TextDecoder().decode(output)).toBe("CMYK");
    });

    it.each([
        [["-threshold", "50%"], [0, 1, 0, 0, 0]],
        [["-auto-threshold", "OTSU"], [0, 1, 1, 0, 0]],
    ] as const)(`${mode}: retains RGBA threshold pixels for %j`, async (operation, white) => {
        const output = await run(rgba, [...operation, "+channel"], "PNG64:out");
        expect([...decodeImage(output).data16!]).toEqual(white.flatMap(value => Array<number>(4).fill(value * 65535)));
    });
}
