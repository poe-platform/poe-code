import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MSB raw CMYK for xc:#abcdef.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const convert of [false, true]) {
        it.each([
            { depth: 64, hex: "3fd2358e758e758e3fc2358e758e758e00000000000000003fb0101010101010" },
            { depth: 32, hex: "3e91ac743e11ac74000000003d808081" },
        ])(`${mode}, explicit CMYK=${convert}: exports native $depth-bit ink samples`, async ({ depth, hex }) => {
            const args = ["xc:#abcdef", ...(convert ? ["-colorspace", "CMYK"] : []), "-depth", String(depth),
                "-endian", "MSB", "-define", "quantum:format=floating-point", "cmyk:-"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}
