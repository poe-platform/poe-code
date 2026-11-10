import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MSB RGBA16 output.
const cases = [
    { name: "Q16 single-color mean", colors: ["#202030304040", "#202130304040", "#803040304040"], operations: ["+dither", "-colors", "1"], expected: "402635854040ffff402635854040ffff402635854040ffff" },
    { name: "Q16 two-color palette", colors: ["#202030304040", "#202130304040", "#803040304040"], operations: ["+dither", "-colors", "2"], expected: "202130304040ffff202130304040ffff803040304040ffff" },
    { name: "Q16 unreduced palette", colors: ["#202030304040", "#202130304040", "#803040304040"], operations: ["+dither", "-colors", "8"], expected: "202130304040ffff202130304040ffff803040304040ffff" },
    { name: "linear RGB palette", colors: ["#b03010", "#302010", "#505080", "#a07070", "#d0d020"], operations: ["-colorspace", "RGB", "+dither", "-colors", "2", "-colorspace", "sRGB"], expected: "82ae4bed581dffff82ae4bed581dffff82ae4bed581dffff82ae4bed581dffffd0d0d0d02020ffff" },
    { name: "Q16 input control", colors: ["#202030304040", "#202130304040", "#803040304040"], operations: [], expected: "202030304040ffff202130304040ffff803040304040ffff" },
    { name: "linear RGB control", colors: ["#b03010", "#302010", "#505080", "#a07070", "#d0d020"], operations: ["-colorspace", "RGB", "-colorspace", "sRGB"], expected: "b0b030301010ffff303020201010ffff505050508080ffffa0a070707070ffffd0d0d0d02020ffff" },
    { name: "reduced alpha", colors: ["#00000080", "#000000ff"], operations: ["-colors", "1"], expected: "000000000000c040000000000000c040" },
    { name: "reduced RGB", colors: ["#101010", "#111111"], operations: ["-colors", "1"], expected: "109110911091ffff109110911091ffff" },
    { name: "negated reduced alpha", colors: ["#00000080", "#000000ff"], operations: ["-colors", "1", "-negate"], expected: "ffffffffffff3fc0ffffffffffff3fc0" },
    { name: "unreduced alpha", colors: ["#00000080", "#000000ff"], operations: [], expected: "0000000000008080000000000000ffff" },
    { name: "unreduced RGB", colors: ["#101010", "#111111"], operations: [], expected: "101010101010ffff111111111111ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) for (const height of [1, 513]) {
    it.each(cases)(`${mode}, ${height} rows: preserves sub-byte precision for $name`, async ({ colors, operations, expected }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = [...(height === 1 ? [] : ["-size", `1x${height}`]), ...colors.map(color => `xc:${color}`), "+append", ...operations, "-depth", "16", "-endian", "MSB", "rgba:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(height));
    });
}
