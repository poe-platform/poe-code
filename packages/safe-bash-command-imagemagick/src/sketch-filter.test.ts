import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 123, two opaque RGB pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    [["-filter", "Point"], [], "ffffffffffff"],
    [["-filter", "Triangle"], [], "14283cffffff"],
    [["-filter", "Box"], [], "14283cffffff"],
    [["-filter", "Lanczos"], [], "132538ffffff"],
    [[], [], "132538ffffff"],
    [["-filter", "Point", "+filter"], [], "132538ffffff"],
    [["-filter", "Point"], ["+filter"], "ffffffffffff"],
    [["-filter", "Triangle"], ["-filter", "Point"], "14283cffffff"],
    [[], ["-filter", "Point"], "132538ffffff"],
] as const)(`${mode}: sketches with selected resize filter %j`, async (filter, after, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
    const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["-seed", "123", "/in.ppm", ...filter, "-sketch", "0x1+45",
        ...after, "-depth", "8", "rgb:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
