import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGBA8 and extracted coverage.
const coverage = ["18", "36", "49", "36", "7a", "a5", "49", "a5", "de"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [alpha, rgb] of [["Disassociate", "24f5ff"], ["Associate", "093e6a"], ["", "127bd3"]]) {
        it.each(["rgba", "PNG32", "info", "gray"])(`${mode}: vignette exports coverage after ${alpha || "default alpha"} (%s)`, async coder => {
            const argv = ["-size", "3x3", "xc:#127bd380", ...(alpha ? ["-alpha", alpha] : []),
                "-background", "none", "-vignette", "0x1+1+1",
                ...(coder === "gray" ? ["-alpha", "extract"] : []),
                ...(coder === "info" ? ["-format", "%[channels]|%[opaque]"] : ["-depth", "8"]),
                `${coder}:${mode === "command" ? "-" : "/out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(chunks)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            const pixels = coder === "PNG32" ? decodeImage(output).data : output;
            expect(Buffer.from(pixels).toString(coder === "info" ? "utf8" : "hex")).toBe(
                coder === "info" ? "srgba 4.0|False" : coverage.map(a => coder === "gray" ? a : rgb + a).join(""));
        });
    }
}
