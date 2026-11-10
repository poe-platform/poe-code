import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const planes = ["xc:#808080", "xc:#404040", "xc:#282828", "xc:#606060"];
const copy = ["xc:#80402860", "-alpha", "Copy", "-channel", "All", "-separate", "+channel"];
// Native ImageMagick 7.1.2-35 Q16-HDRI, including the unchanged alpha extraction controls.
const cases = [
    { input: [...planes, "-alpha", "Off"], output: ["-depth", "8", "rgba:/out"], expected: "80402860" },
    { input: [...planes, "-alpha", "Off"], output: ["-format", "%[channels]|%[opaque]", "info:/out"], expected: "srgba 4.0|False" },
    { input: copy, output: ["-depth", "8", "rgba:/out"], expected: "8040284c" },
    { input: ["xc:#80402860", "-colorspace", "CMYK", "-alpha", "Off", "-channel", "All", "-separate", "+channel"], output: ["-depth", "8", "rgba:/out"], expected: "0080af7f" },
    { input: [...planes, "-alpha", "Off"], output: ["-channel", "A", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "60" },
    { input: planes, output: ["-depth", "8", "rgba:/out"], expected: "80402860" },
    { input: planes, output: ["-format", "%[channels]|%[opaque]", "info:/out"], expected: "srgba 4.0|False" },
    { input: copy, output: ["-channel", "A", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "4c" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`${mode}: combines $input into $output`, async ({ input, output, expected }) => {
        const files = new Map([["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = [...input, "-combine", ...output];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output.at(-1) === "info:/out" ? "utf8" : "hex")).toBe(expected);
    });
}
