import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const input = new Uint8Array([
    ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    25, 25, 25, 10, 200, 31, 0, 150, 60, 128, 220, 201, 20, 80, 10, 255,
]);

const alphaHeader = new TextEncoder().encode("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 5\nMAXVAL 65535\nTUPLTYPE CMYK_ALPHA\nENDHDR\n");
const alphaInput = new Uint8Array(alphaHeader.length + 20);
alphaInput.set(alphaHeader);
[5000, 5000, 5000, 12000, 0, 10000, 10001, 10000, 65535, 32768]
    .forEach((value, index) => new DataView(alphaInput.buffer).setUint16(alphaHeader.length + index * 2, value));
const alphaFormat = [0, 1].flatMap(pixel => ["r", "g", "b", "k", "a"].map(channel => `%[fx:round(p{${pixel},0}.${channel}*65535)]`)).join(" ");

// ImageMagick 7.1.2-35 Q16-HDRI, querying original ink samples without RGB conversion.
for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["-channel", "K", "-negate", "+channel"], expected: "CMYK 0.0980392 0.960784 0.784314 0.411765" },
        { operations: ["-channel", "R", "-negate", "+channel"], expected: "CMYK 0.901961 0.0392157 0.215686 0.588235" },
        { operations: ["-negate", "+channel"], expected: "CMYK 0.901961 0.960784 0.215686 0.411765" },
        { operations: ["+negate", "+channel"], expected: "CMYK 0.901961 0.960784 0.784314 0.588235" },
        { operations: [], expected: "CMYK 0.0980392 0.0392157 0.784314 0.588235" },
        { operations: ["-channel", "A", "-negate", "+channel"], expected: "CMYK 0.0980392 0.0392157 0.784314 0.588235" },
        { operations: ["-channel", "K", "+negate", "+channel"], expected: "CMYK 0.0980392 0.960784 0.784314 0.588235" },
        { source: alphaInput, format: alphaFormat, operations: ["-negate"], expected: "60535 60535 60535 53535 65535 55535 55534 55535 0 32767" },
        { source: alphaInput, format: alphaFormat, operations: ["+negate"], expected: "60535 60535 60535 53535 65535 10000 10001 10000 65535 32768" },
        { source: alphaInput, format: alphaFormat, operations: ["-channel", "K", "-negate"], expected: "5000 5000 5000 53535 0 10000 10001 10000 0 32768" },
        { source: alphaInput, format: alphaFormat, operations: ["-channel", "A", "-negate"], expected: "5000 5000 5000 12000 65535 10000 10001 10000 65535 32767" },
        { source: alphaInput, format: alphaFormat, operations: ["-channel", "CMY", "-negate"], expected: "60535 60535 60535 12000 0 55535 55534 55535 65535 32768" },
        { operations: ["-negate", "-negate"], expected: "CMYK 0.0980392 0.0392157 0.784314 0.588235" },
    ])(`${mode}: CMYK $operations`, async ({ operations, expected, source = input, format = "%[colorspace] %[fx:u.r] %[fx:u.k] %[fx:p{1,0}.r] %[fx:p{1,0}.k]" }) => {
        const files = new Map([["ink.pam", source], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["ink.pam", ...operations, "+channel", "-interpolate", "integer", "-format", format, "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode}: compare forwards black channel selection to negate`, async () => {
        const negative = input.slice();
        [245, 105, 54, 0].forEach((black, index) => { negative[negative.length - 13 + index * 4] = black; });
        const files = new Map([["ink.pam", input], ["negative.pam", negative]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile("/" + name, bytes);
        const args = ["(", "ink.pam", "-channel", "K", "-negate", "+channel", ")", "negative.pam", "null:"];
        const result = mode === "sync" ? runCompareCliSync(args, files)
            : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    });
}
