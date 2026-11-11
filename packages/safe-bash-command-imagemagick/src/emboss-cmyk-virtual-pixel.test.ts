import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: in.ppm -colorspace CMYK
// -virtual-pixel METHOD -emboss 1x1 -depth 8 cmyk:-.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { method: "white", expected: "000000000000000000000000000000000000000000ffff00000000ff0000000000000000" },
    { method: "gray", expected: "ff5500ff550000ff000000aa000000000000000000ffff00aa0000ff550000ff00000000" },
    { method: "edge", expected: "ffff00ff993300ff330000ff000000000000000000ffff00993300ff3300009933000066" },
    { method: "black", expected: "ffff00ffff6d00ff922400ff240000240000000000ffff00ff9200ffff0000ff922400ff" },
    { method: "background", expected: "000000ff000000ff000000ff000000000000000000ffff00000000ff000000ff000000ff" },
])(`${mode}: embosses all CMYK inks with $method virtual pixels`, async ({ method, expected }) => {
    const input = Buffer.from("50360a3320330a3235350a03142434445464758595a5b5c5d6e6f606162637475767778798a8", "hex");
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-colorspace", "CMYK", "-virtual-pixel", method, "-emboss", "1x1", "-depth", "8", "cmyk:-"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
