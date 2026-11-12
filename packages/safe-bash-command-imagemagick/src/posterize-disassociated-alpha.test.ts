import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inactive alpha must not weight the dither palette lookup.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const coder of ["rgba", "PNG32"]) it.each([
        { color: "124c9e40", operations: ["-alpha", "Disassociate"], hex: "80ffffff" },
        { color: "124c9e40", operations: ["-alpha", "Disassociate", "-dither", "FloydSteinberg"], hex: "80ffffff" },
        { color: "124c9e40", operations: ["-alpha", "Disassociate", "-dither", "Riemersma"], hex: "80ffffff" },
        { color: "124c9e40", operations: ["-alpha", "Disassociate", "-dither", "None"], hex: "80ffffff" },
        { color: "124c9e40", operations: ["-alpha", "Disassociate", "-clamp", "-dither", "FloydSteinberg"], hex: "80ffffff" },
        { color: "124c9e40", operations: ["-dither", "FloydSteinberg"], hex: "00000080" },
        { color: "124c9eff", operations: ["-alpha", "Disassociate", "-dither", "FloydSteinberg"], hex: "008080ff" },
        ...["Associate", "Deactivate", "Discrete"].flatMap(alpha => ["FloydSteinberg", "Riemersma"].map(dither => ({
            color: "124c9e40", operations: ["-alpha", alpha, "-dither", dither], hex: "000000ff"
        })))
    ])(`${mode}: ${coder} $color $operations`, async ({ color, operations, hex }) => {
        const argv = ["-seed", "42", `xc:#${color}`, ...operations, "-posterize", "3", "-depth", "8", `${coder}:-`];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        expect(Buffer.from(coder === "PNG32" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(hex);
    });
}
