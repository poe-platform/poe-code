import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
const white = "91b3d5ff91b3d5ff91b3d5ffffffffff91b3d5ffaca9a8ffaca9a8fffffffffffffffffffee2c7fffee2c7ffffffffff";
const lime = "12b356ff12b356ff12b356ff00ff00ff12b356ff4da949ff4da949ff00ff00ff00ff00ff3fe208ff3fe208ff00ff00ff";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"]])
it.each([
    { name: "default", first: [], second: [], options: [], expected: white },
    { name: "explicit", first: [], second: [], options: ["-background", "lime"], expected: lime },
    { name: "list image property", first: [], second: [], options: ["-set", "background", "lime"], expected: lime },
    { name: "list option property", first: [], second: [], options: ["-set", "option:background", "lime"], expected: lime },
    { name: "first layer property", first: ["-set", "background", "lime"], second: [], options: [], expected: lime },
    { name: "second layer property", first: [], second: ["-set", "background", "lime"], options: [], expected: white }
])(`${mode} ${operation.join(" ")}: $name`, async ({ first, second, options, expected }) => {
    const argv = ["-respect-parentheses",
        "(", "-size", "3x2", "xc:#2468ac80", "-repage", "4x3+0+0", ...first, ")",
        "(", "-size", "2x2", "xc:#fc8a2040", "-repage", "4x3+1+1", ...second, ")",
        ...options, ...operation, "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : new TextEncoder().encode("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
