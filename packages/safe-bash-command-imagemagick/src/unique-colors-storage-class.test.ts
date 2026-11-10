import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex");

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs, including pre-extraction controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["-colors", "4", "-unique-colors"], expected: "DirectClass sRGB Alpha|srgba 4.0|4;" },
        { operations: ["-type", "PaletteAlpha", "-unique-colors"], expected: "DirectClass sRGB Alpha|srgba 4.0|6;" },
        { operations: ["-colors", "4"], expected: "PseudoClass sRGB Alpha|srgba 5.0|4;" },
        { operations: ["-type", "PaletteAlpha"], expected: "PseudoClass sRGB Alpha|srgba 5.0|6;" },
        { operations: ["-unique-colors"], expected: "DirectClass sRGB Alpha|srgba 4.0|6;" },
    ])(`reports storage class and channels after $operations (${mode})`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.raw", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["-size", "4x2", "-depth", "8", "rgba:/in.raw", ...operations, "-format", "%r|%[channels]|%k;", "info:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
