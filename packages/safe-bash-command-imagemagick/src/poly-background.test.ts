import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const output of ["rgba:-", "PNG32:-"]) {
        it.each([
            { name: "grouped background", grouped: true, background: true, size: "1x1", expected: "12345680a9bc8370" },
            { name: "ungrouped background", grouped: false, background: true, size: "1x1", expected: "12345680a9bc8370" },
            { name: "default background", grouped: true, background: false, size: "1x1", expected: "12345680ffffffff" },
            { name: "equal sizes", grouped: true, background: true, size: "2x1", expected: "1234568012345680" },
        ])(`${mode} ${output}: preserves $name for polynomial padding`, async ({ grouped, background, size, expected }) => {
            const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
            let stderr = "";
            const args = [
                ...(grouped ? ["-respect-parentheses", "("] : []),
                "-size", "2x1", "xc:#27548380",
                ...(grouped ? [")", "("] : []),
                "-size", size, "xc:#12345680",
                ...(background ? ["-background", "#a9bc8370"] : []),
                "-virtual-pixel", "Background",
                ...(grouped ? [")"] : []),
                "-poly", "0,1,1,1", "-colorspace", "sRGB", "-depth", "8", output,
            ];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(output === "PNG32:-" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
        });
    }
}
