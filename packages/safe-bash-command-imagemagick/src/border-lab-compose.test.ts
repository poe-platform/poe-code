import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: compose borders in the image's working colorspace.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colorspace: "Lab", compose: "Copy", expected: "0091d6404080c0800091d640" },
        { colorspace: "Lab", compose: "Multiply", expected: "0091d640009fdea00091d640" },
        { colorspace: "Lab", compose: "Xor", expected: "0091d64000a2e8800091d640" },
        { colorspace: "Lab", compose: "Over", expected: "0091d640008dcca00091d640" },
        { colorspace: "sRGB", compose: "Copy", expected: "204020404080c08020402040" },
    ].flatMap(test => [{ ...test, width: 1, height: 1 }, { ...test, width: 1025, height: 2 }]))(`${mode}: $colorspace border with $compose at $width x $height`, async ({ colorspace, compose, expected, width, height }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", `${width}x${height}`, "xc:#4080c080", "-alpha", "On", "-colorspace", colorspace, "-bordercolor", "#20402040",
            "-compose", compose, "-border", "1x0", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe((expected.slice(0, 8) + expected.slice(8, 16).repeat(width) + expected.slice(16)).repeat(height));
    });
}
