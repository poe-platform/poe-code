import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 8-bit RGBA stdout.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "translucent source over transparent backdrop", input: ["xc:none", "xc:#12457880"], operation: ["-composite"], hex: "12457880" },
        { name: "single translucent layer", input: ["xc:#12457880"], operation: ["-layers", "merge"], hex: "12457880" },
        { name: "two translucent colors", input: ["xc:#12457880", "xc:#ab8900c0"], operation: ["-composite"], hex: "4c4411e0" },
        { name: "two translucent layers", input: ["xc:#12457880", "xc:#ab8900c0"], operation: ["-layers", "merge"], hex: "4c4411e0" },
        { name: "two opaque layers", input: ["xc:#124578", "xc:#ab8900"], operation: ["-layers", "merge"], hex: "000000ff" }
    ])(`${mode}: LinearBurn $name`, async ({ input, operation, hex }) => {
        const argv = [...input, "-background", "none", "-compose", "LinearBurn", ...operation, "-depth", "8", "rgba:-"];
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
