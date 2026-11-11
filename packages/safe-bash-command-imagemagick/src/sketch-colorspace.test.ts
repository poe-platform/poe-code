import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, LC_ALL=C, MAGICK_THREAD_LIMIT=1, seed 123.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["HSL", true, "rgb", "480202ffffff"],
    ["Lab", true, "rgb", "a10018ff5a00"],
    ["CMYK", true, "cmyk", "ff9f00fffff100ff"],
    ["CMYK", false, "cmyk", "aa5500e14e27007d"],
    ["sRGB", true, "rgb", "132538ffffff"],
] as const)(`${mode}: sketches %s working samples (sketch=%s)`, async (space, sketch, format, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
    const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["-seed", "123", "in.ppm", "-colorspace", space,
        ...(sketch ? ["-sketch", "0x1+45"] : []), "-depth", "8", `${format}:-`];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
