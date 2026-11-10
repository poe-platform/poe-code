import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA stdout.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) it.each([
        { operation: "Optimize", second: "red", hex: "ff0000ff00000000" },
        { operation: "OptimizeFrame", second: "red", hex: "ff0000ffffffff00" },
        { operation: "Optimize", second: "none", hex: "ff0000ff00000000" },
        { operation: "OptimizeFrame", second: "lime", hex: "ff0000ff00ff00ff" }
    ])(`${mode}: $operation red/$second raw frames at depth ${depth}`, async ({ operation, second, hex }) => {
        const argv = ["-size", "1x1", "xc:red", `xc:${second}`, "-layers", operation, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
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
        expect(Buffer.from(bytes).toString("hex")).toBe(depth === 8 ? hex
            : Array.from(Buffer.from(hex, "hex"), byte => byte.toString(16).padStart(2, "0").repeat(2)).join(""));
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["Optimize", "OptimizeFrame"])(`${mode}: %s retains pause timing and canvas`, async operation => {
        const argv = ["-size", "3x2", "-delay", "7", "xc:red", "-delay", "13", "xc:red", "-delay", "21", "xc:lime",
            "-layers", operation, "-format", "%wx%h %g %T %D;", "info:-"];
        const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("3x2 3x2+0+0 7 None;1x1 3x2-1-1 13 None;3x2 3x2+0+0 21 None;");
    });
}
