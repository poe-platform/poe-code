import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const type of ["Palette", "PaletteAlpha"]) {
        it.each([
            { name: "linear colorspace", linear: true, output: ["-format", "%[colorspace]", "info:out"], expected: "RGB", info: true },
            { name: "linear 16-bit red", linear: true, output: ["-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"], expected: "3742" },
            { name: "linear red threshold", linear: true, output: ["-channel", "R", "-threshold", "19352", "-separate", "+channel", "-depth", "8", "gray:out"], expected: "00" },
            { name: "sRGB colorspace", linear: false, output: ["-format", "%[colorspace]", "info:out"], expected: "sRGB", info: true },
            { name: "sRGB 16-bit red", linear: false, output: ["-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"], expected: "8080" },
        ])(`${mode}: ${type} preserves $name`, async ({ linear, output, expected, info }) => {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = [type === "Palette" ? "xc:#804020" : "xc:#80402080", ...(linear ? ["-colorspace", "RGB"] : []), "+dither", "-type", type, ...output];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(bytes).toString(info ? "utf8" : "hex")).toBe(expected);
        });
    }
}
