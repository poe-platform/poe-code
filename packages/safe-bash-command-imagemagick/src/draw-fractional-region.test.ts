import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: A,B,A with B a quarter quantum above A.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const fractional of [true, false])
for (const fuzz of ["0", "1%"])
it.each([
    { operation: ["-draw", "color 0,0 replace"], pixel: "ff000080", global: true },
    { operation: ["-draw", "color 0,0 floodfill"], pixel: "ff000080", global: false },
    { operation: ["-draw", "alpha 0,0 replace"], pixel: "77889980", global: true },
    { operation: ["-draw", "alpha 0,0 floodfill"], pixel: "77889980", global: false },
    { operation: ["-fill", "red", "-floodfill", "+0+0", "#778899"], pixel: "ff0000ff", global: false },
])(`${mode}: $operation selects matching regions (fractional=${fractional}, fuzz=${fuzz})`, async ({ operation, pixel, global }) => {
    const argv = [
        ...(fractional
            ? ["-size", "1x1", "xc:#778899", "(", "+clone", "-channel", "B", "-evaluate", "add", "0.25", "+channel", ")"]
            : ["xc:#777788889999", "xc:#7777888899b9"]),
        "+append", "xc:#778899", "+append", "-fuzz", fuzz,
        "-fill", "rgba(255,0,0,0.5)", ...operation, "-depth", "8", "rgba:-",
    ];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(fuzz === "1%"
        ? pixel.repeat(3) : pixel + "778899ff" + (global ? pixel : "778899ff"));
});
