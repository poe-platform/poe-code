import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, xc:#12345680, floating-point MSB exports.
const fixtures = [
    { coder: "gray", depth: 16, hex: "31ed" },
    { coder: "gray", depth: 32, hex: "3e3da309" },
    { coder: "gray", depth: 64, hex: "3fc7b46114611461" },
    { coder: "rgb", depth: 64, hex: "3fb21212121212123fca1a1a1a1a1a1a3fd5959595959596" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const endian of ["MSB", "LSB"]) {
        for (const destination of ["stdout", "file"]) {
            it.each(fixtures)(`${mode} ${endian} ${destination}: preserves Q16 gray precision in $depth-bit $coder output`, async ({ coder, depth, hex }) => {
                const files = new Map<string, Uint8Array>();
                const fs = new MemoryFileSystem();
                const args = ["xc:#12345680", "-depth", String(depth), "-endian", endian,
                    "-define", "quantum:format=floating-point", `${coder}:${destination === "stdout" ? "-" : "/out"}`];
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const expected = Buffer.from(hex, "hex");
                if (endian === "LSB") {
                    if (depth === 16) expected.swap16();
                    else if (depth === 32) expected.swap32();
                    else expected.swap64();
                }
                const actual = destination === "file"
                    ? mode === "command" ? await fs.readFile("/out") : files.get("/out")!
                    : mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
                expect(Buffer.from(actual)).toEqual(expected);
            });
        }
    }
}
