import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI treats alpha Off as opaque during border composition.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Off", compose: "Copy", expected: "204020404080c0ff20402040" },
        { alpha: "Off", compose: "Multiply", expected: "20402040326896ff20402040" },
        { alpha: "Off", compose: "Xor", expected: "20402040306090bf20402040" },
        { alpha: "Off", compose: "Over", expected: "204020404080c0ff20402040" },
        { alpha: "On", compose: "Copy", expected: "204020404080c08020402040" },
    ])(`${mode}: border $compose with alpha $alpha`, async ({ alpha, compose, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#4080c080", "-alpha", alpha, "-colorspace", "sRGB", "-bordercolor", "#20402040",
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
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
