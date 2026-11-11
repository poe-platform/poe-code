import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: comments include their terminating newline.
for (const format of ["pfm", "phm"] as const) for (const comment of [false, true]) {
    for (const mode of ["command", "sync", "buffered"] as const) it(`reads ${format} comments through ${mode}, comment=${comment}`, async () => {
        const bytes = Buffer.concat([
            Buffer.from(`${format === "pfm" ? "Pf" : "Ph"}\n${comment ? "#my note\n" : ""}2 1\n1.0\n`),
            Buffer.from(format === "pfm" ? "3e0000003f000000" : "30003800", "hex")
        ]);
        const path = `/in.${format}`, fs = new MemoryFileSystem();
        await fs.writeFile(path, bytes);
        const args = [path, "-format", "%wx%h:%c;", "info:"], argumentValues = createCommandArguments(args);
        const files = new Map([[path, bytes]]);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(`2x1:${comment ? "my note\n" : ""};`);
    });
}
