import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale"]) for (const format of ["rgba", "PNG32"]) {
        it.each([
            { name: "reduced", before: ["-region", "1x1+1+0"], geometry: "2x1!", after: [], expected: "00000000".repeat(2) },
            { name: "enlarged", before: ["-region", "1x1+1+0"], geometry: "4x2!", after: [], expected: "00000000".repeat(8) },
            { name: "later edit", before: ["-region", "1x1+1+0"], geometry: "2x1!", after: ["-negate"], expected: "ffffff00".repeat(2) },
            { name: "cleared region", before: ["-region", "1x1+1+0"], geometry: "2x1!", after: ["+region"], expected: "000000ff".repeat(2) },
            { name: "unmasked", before: [], geometry: "2x1!", after: [], expected: "ff0000ff".repeat(2) },
        ])(`${mode}: ${operation} active region ${format} $name`, async ({ before, geometry, after, expected }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "3x2", "xc:red", ...before, operation, geometry, ...after, "-depth", "8", `${format}:/out`];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "rgba" ? output : decodeImage(output).data).toString("hex")).toBe(expected);
        });
    }
}
