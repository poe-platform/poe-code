import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 8-bit RGBA stdout.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "Optimize composites translucent frames", input: ["xc:#80402080", "xc:#204080c0"], options: ["-layers", "Optimize"], hex: "804020802e4072e0" },
        { name: "OptimizeFrame preserves the original pixels", input: ["xc:#80402080", "xc:#204080c0"], options: ["-layers", "OptimizeFrame"], hex: "80402080204080c0" },
        { name: "unoptimized frames preserve the original pixels", input: ["xc:#80402080", "xc:#204080c0"], options: [], hex: "80402080204080c0" },
        { name: "Optimize preserves opaque frames", input: ["xc:red", "xc:blue"], options: ["-layers", "Optimize"], hex: "ff0000ff0000ffff" }
    ])(`${mode}: $name`, async ({ input, options, hex }) => {
        const argv = [...input, ...options, "-depth", "8", "rgba:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
