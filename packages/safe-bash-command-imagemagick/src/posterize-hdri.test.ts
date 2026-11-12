import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: multiply working channels by four,
// posterize at three levels without dithering, then convert to sRGB RGBA8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const coder of ["rgba", "PNG32"] as const) {
        it.each([
            { space: "Lab", clamp: false, expected: "ff00ff80" },
            { space: "HSL", clamp: false, expected: "ff000080" },
            { space: "CMYK", clamp: false, expected: "ff800080" },
            { space: "Lab", clamp: true, expected: "ff5a0080" },
            { space: "HSL", clamp: true, expected: "ffffff80" },
            { space: "CMYK", clamp: true, expected: "00000080" },
            { space: "sRGB", clamp: false, expected: "80ffff80" },
        ])(`${mode}: ${coder} posterization preserves $space HDRI samples, clamp=$clamp`, async ({ space, clamp, expected }) => {
            const argv = ["-seed", "42", "xc:#124c9e40", "-colorspace", space,
                "-channel", space === "CMYK" ? "CMYK" : "RGB", "-evaluate", "Multiply", "4", "+channel",
                ...(clamp ? ["-clamp"] : []), "-dither", "None", "-posterize", "3",
                "-colorspace", "sRGB", "-depth", "8", `${coder}:${mode === "command" ? "-" : "/out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argumentValues = createCommandArguments(argv);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(coder === "PNG32" ? decodeImage(output).data : output).toString("hex")).toBe(expected);
        });
    }
}
