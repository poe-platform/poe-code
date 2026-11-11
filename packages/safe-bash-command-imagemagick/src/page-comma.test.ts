import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps WxH before a trailing comma field.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const geometry of ["3x2", "3x2,7", "3x2,"]) {
        for (const flatten of [false, true]) {
            it(`${mode} preserves page height for ${geometry} (${flatten ? "set and flatten" : "repage"})`, async () => {
                const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
                const args = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1",
                    ...(flatten ? ["-set", "page", geometry, "-background", "black", "-flatten"] : ["-repage", geometry]),
                    "-depth", "8", "-write", "rgba:/pixels", "-format", "%wx%h|%g;", "info:"];
                let stdout = "", stderr = "";
                const argumentValues = createCommandArguments(args);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                    .toEqual({ exitCode: 0, stdout: `3x2|3x2+${flatten ? "0+0" : "1+1"};`, stderr: "" });
                const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
                expect(Buffer.from(pixels).toString("hex")).toBe(flatten
                    ? "000000ff".repeat(4) + "ff0000ff".repeat(2) : "ff0000ff".repeat(6));
            });
        }
    }
}
