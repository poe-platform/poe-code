import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reports retained alpha in the storage description.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { alpha: "deactivate", format: "%r", expected: "DirectClass sRGB Alpha" },
        { alpha: "discrete", format: "%r", expected: "DirectClass sRGB Alpha" },
        { alpha: "deactivate", format: "%[channels]", expected: "srgba 4.0" },
        { alpha: "off", format: "%r", expected: "DirectClass sRGB " },
        { alpha: "on", format: "%r", expected: "DirectClass sRGB Alpha" }
    ])(`${mode}: formats $format after -alpha $alpha`, async ({ alpha, format, expected }) => {
        const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");
        const files = new Map([["/in.raw", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-size", "4x2", "-depth", "8", "rgba:/in.raw", "-alpha", alpha, "-format", format, "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
