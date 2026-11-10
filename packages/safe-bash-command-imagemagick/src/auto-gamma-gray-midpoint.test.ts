import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA with MSB byte order.
const cases = [
    { name: "converted Gray at 16 bits", input: "#4080c080", space: "Gray", gamma: true, depth: "16", expected: "8000800080008080" },
    { name: "converted Gray at 8 bits", input: "#4080c080", space: "Gray", gamma: true, depth: "8", expected: "80808080" },
    { name: "neutral Gray control", input: "#80808040", space: "Gray", gamma: true, depth: "16", expected: "8000800080004040" },
    { name: "sRGB control", input: "#4080c080", space: "sRGB", gamma: true, depth: "16", expected: "80008080c0c08080" },
    { name: "unadjusted Gray control", input: "#4080c080", space: "Gray", gamma: false, depth: "16", expected: "777a777a777a8080" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: matches native midpoint rounding for $name`, async ({ input, space, gamma, depth, expected }) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = [`xc:${input}`, "-colorspace", space, "-channel", "R", ...(gamma ? ["-auto-gamma"] : []), "+channel", "-depth", depth, "-endian", "MSB", "rgba:/out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
