import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rejects bare radii with offsets but accepts dimensioned geometry.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(["1+2", "1-2", "1+0+0", "1", "1x1+2"])(`${mode}: validates spread radius %s`, async radius => {
        const fs = new MemoryFileSystem();
        const args = ["xc:red", "xc:green", "xc:blue", "+append", "-seed", "2", "-virtual-pixel", "tile", "-interpolate", "bilinear", "-spread", radius, "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        const valid = radius === "1" || radius === "1x1+2";
        expect(result.exitCode).toBe(valid ? 0 : 1);
        const error = "stderr" in result ? result.stderr : stderr;
        if (valid) expect(error).toBe("");
        else expect(error).toContain("invalid argument for option '-spread'");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(valid ? "00633a7a4300004f62" : "");
    });
}
