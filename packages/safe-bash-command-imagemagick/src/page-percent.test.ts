import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const beforeInput of [false, true]) {
        it.each([
            ["25%", "25x25"],
            ["50%", "50x50"],
            ["100%", "100x100"],
            ["50x50%", "50x50"],
            ["8", "8x0"],
        ])(`${mode}, beforeInput=${beforeInput}: -page %s`, async (geometry, page) => {
            const input = Buffer.concat([Buffer.from("P5\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => 17 + 13 * i))]);
            const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            const args = [...(beforeInput ? ["-page", geometry, "/in.pgm"] : ["/in.pgm", "-page", geometry]),
                "-format", "%wx%h:%Wx%H%X%Y", "info:"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: `5x3:${page}+0+0`, stderr: "" });
        });
    }
}
