import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 treats a scalar page size ending in @ as a width.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const geometry of ["6@", "6"]) {
        it.each([
            { options: ["-repage", geometry], expected: "3x2|6x6+1+1;", flatten: false },
            { options: ["-set", "page", geometry], expected: "3x2|6x3+1+1;", flatten: false },
            { options: ["-set", "page", geometry, "-background", "black", "-flatten"], expected: "6x3|6x3+0+0;", flatten: true },
        ])(`${mode}: retains scalar width for $options`, async ({ options, expected, flatten }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", ...options,
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
                .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
            const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
            expect(Buffer.from(pixels).toString("hex")).toBe(flatten
                ? "000000ff".repeat(6) + ("000000ff" + "ff0000ff".repeat(3) + "000000ff".repeat(2)).repeat(2)
                : "ff0000ff".repeat(6));
        });
    }
}
