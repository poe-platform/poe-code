import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, integer raw CMYK after working-colorspace conversion.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "#123456", space: "Lab", coder: "cmyk", depth: 16, convert: false, hex: "ca6265350000a9a9" },
        { color: "#123456", space: "Lab", coder: "cmyka", depth: 16, convert: false, hex: "ca6265350000a9a9ffff" },
        { color: "#123456", space: "YCbCr", coder: "cmyk", depth: 16, convert: false, hex: "ca6065300000a9a5" },
        { color: "#123456ff", space: "YCbCr", coder: "cmyk", depth: 16, convert: false, hex: "ca6065300000a9a5" },
        { color: "#123456ff", space: "Lab", coder: "cmyk", depth: 16, convert: false, hex: "ca6265350000a9a9" },
        { color: "#123456", space: "Lab", coder: "cmyk", depth: 16, convert: true, hex: "ca6265350000a9a9" },
        { color: "#123456", space: "Lab", coder: "cmyk", depth: 8, convert: false, hex: "c76600a8" },
    ])(`${mode}: $color in $space to $coder at $depth bits, explicit CMYK=$convert`, async ({ color, space, coder, depth, convert, hex }) => {
        const args = [`xc:${color}`, "-colorspace", space, ...(convert ? ["-colorspace", "CMYK"] : []),
            "-depth", String(depth), "-endian", "MSB", `${coder}:-`];
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
