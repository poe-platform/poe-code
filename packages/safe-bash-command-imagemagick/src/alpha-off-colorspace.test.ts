import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "buffered", "sync"] as const) {
    for (const colorspace of ["HSL", "Lab", "sRGB", "CMYK"]) {
        // Native ImageMagick 7.1.2-35 Q16-HDRI: Off discards alpha; Deactivate retains it.
        it.each([
            { alpha: "Off", expected: "20406000" },
            { alpha: "Deactivate", expected: "20406080" },
        ])(`${execution}: ${colorspace} $alpha followed by Activate and sRGB conversion`, async ({ alpha, expected }) => {
            const argv = ["xc:#20406080", "-colorspace", colorspace, "-alpha", alpha,
                "-alpha", "activate", "-colorspace", "sRGB", "-depth", "8", execution === "command" ? "rgba:-" : "rgba:/out"];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : execution === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = execution === "command" ? Buffer.concat(chunks) : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
