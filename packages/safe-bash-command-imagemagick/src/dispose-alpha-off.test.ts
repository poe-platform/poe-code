import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: transparent canvas margin and opaque source colors.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const depth of [8, 16])
for (const [color, rgba8, rgba16] of [
    ["#33669980", "336699ff", "333366669999ffff"],
    ["#123456789abc8000", "12569aff", "123456789abcffff"],
] as const)
it.each([
    { name: "alpha disabled", alpha: ["-alpha", "off"], dispose: true },
    { name: "alpha reactivated", alpha: ["-alpha", "off", "-alpha", "on"], dispose: true },
    { name: "without disposal", alpha: ["-alpha", "off"], dispose: false },
])(`${mode}, depth ${depth}, ${color}: $name preserves opaque source colors`, async ({ alpha, dispose }) => {
    const argv = ["(", "-size", "2x1", `xc:${color}`, ...alpha, "-repage", "3x1+1+0", ")",
        ...(dispose ? ["-layers", "Dispose"] : []), "-depth", String(depth), "-endian", "MSB", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    const margin = depth === 8 ? "ffffff00" : "ffffffffffff0000";
    const pixel = depth === 8 ? rgba8 : rgba16;
    expect(Buffer.from(bytes).toString("hex")).toBe((dispose ? margin : "") + pixel.repeat(2));
});
