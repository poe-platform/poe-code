import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 123, two-pixel RGB PPM.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["tile", "0x1+45", "0f1d2cffffff"],
    ["mirror", "0x1+45", "132639ffffff"],
    ["black", "0x1+45", "0a141ea8cdf3"],
    ["edge", "0x1+45", "132538ffffff"],
    [undefined, "0x1+45", "132538ffffff"],
    ["tile", "2x2+135", "132538f1ffff"],
    ["mirror", "2x2+135", "0b1520ffffff"],
    ["black", "2x2+135", "0a141e758fa9"],
    ["tile", "0x2-45", "152b40d8ffff"],
    ["mirror", "0x2-45", "0c1824ffffff"],
    ["black", "0x2-45", "0b1621bae3ff"],
] as const)(`${mode}: sketches with %s virtual pixels at %s`, async (method, geometry, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
    const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["-seed", "123", "in.ppm", ...(method ? ["-virtual-pixel", method] : []),
        "-sketch", geometry, "-depth", "8", "rgb:-"];
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
