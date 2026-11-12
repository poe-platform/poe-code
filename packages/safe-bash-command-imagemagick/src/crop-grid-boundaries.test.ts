import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors: Record<string, number[]> = { K: [0, 0, 0], R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255] };
// ImageMagick 7.1.2-35 Q16-HDRI: scene metadata and concatenated RGB pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["info", "rgb"] as const) {
        it.each([
            ["East", "3x2-1+0@", "0:4x2+0+0;1:4x2+1+0;2:4x1+0+2;3:4x1+1+2;", "KRKKKKKGRKKKKKGKKKKKKKKB"],
            ["South", "3x2+0-1@", "0:2x3+0+0;1:3x3+1+0;2:2x3+3+0;", "KRKKKKRKKKKGKKKKKGKKB"],
            ["SouthEast", "3x2-1-1@", "0:4x3+0+0;1:4x3+1+0;", "KRKKKKKGKKKKRKKKKKGKKKKB"],
            ["SouthEast", "3x2@", "0:3x2+0+0;1:3x2+1+0;2:3x2+2+0;3:3x2+0+1;4:3x2+1+1;5:3x2+2+1;", "KRKKKKRKKKKGKKKKGKKKKKKKKKGKKKKGKKKB"],
            ["NorthWest", "3x2-1-1@", "0:4x2+1+1;1:1x2+2+1;2:1x2+4+1;3:4x1+1+2;4:1x1+2+2;5:1x1+4+2;", "KKGKKKKBKKKBKKKBKB"],
        ])(`respects grid crop boundaries (${mode}, ${output}): %s %s`, async (gravity, geometry, metadata, pixels) => {
            const args = ["-size", "5x3", "xc:black", "-fill", "red", "-draw", "point 1,0",
                "-fill", "lime", "-draw", "point 3,1", "-fill", "blue", "-draw", "point 4,2",
                "-gravity", gravity, "-crop", geometry,
                ...(output === "info" ? ["-format", "%s:%wx%h%O;", "info:"] : ["-depth", "8", "rgb:-"])];
            const filesystem = new MemoryFileSystem();
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const stdout = "stdout" in result ? result.stdout : Buffer.concat(chunks).toString();
            const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
            if (output === "info") expect(stdout).toBe(metadata);
            else expect(Buffer.from(bytes)).toEqual(Buffer.from([...pixels].flatMap(pixel => colors[pixel]!)));
        });
    }
}
