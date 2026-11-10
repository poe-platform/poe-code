import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: raw RGBA samples, including transparent RGB.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { name: "red low byte", color: "2346567889ab", alpha: "ffff" },
        { name: "green low byte", color: "2345567989ab", alpha: "ffff" },
        { name: "blue low byte", color: "2345567889ac", alpha: "ffff" },
        { name: "retained opaque color", color: "aaab567889ab", alpha: "ffff" },
        { name: "identical color", color: "2345567889ab", alpha: "0000" },
        { name: "fuzzy match", color: "2346567889ab", alpha: "0000", options: ["-fuzz", "0.01%"] },
        { name: "unoptimized control", color: "2346567889ab", alpha: "ffff", optimize: false },
        { name: "chunk boundary", color: "2346567889ab", alpha: "ffff", width: 1025 },
        { name: "original canvas for third frame", color: "2346567889ab", alpha: "ffff", repeat: true },
    ])(`${mode} preserves 16-bit OptimizeTransparency samples: $name`, async ({ color, alpha, options = [], optimize = true, width = 1, repeat = false }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = ["-size", `${width}x1`, "xc:#2345567889ab", `xc:#${color}`, ...(repeat ? [`xc:#${color}`] : []),
            ...options, ...(optimize ? ["-layers", "OptimizeTransparency"] : []), "-depth", "16", "-endian", "MSB", "rgba:-"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output).toString("hex")).toBe("2345567889abffff".repeat(width) + (color + alpha).repeat(width) + (repeat ? color + "0000" : ""));
    });
}
