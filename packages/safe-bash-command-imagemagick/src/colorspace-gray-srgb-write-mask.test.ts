import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA with the mask attached after conversion to Gray.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const width of [1, 513])
it.each([
    { name: "gray50 mask removed after conversion", mask: "gray50", after: ["+write-mask"], expected: "3597359735978080" },
    { name: "gray50 mask retained", mask: "gray50", expected: "3597359735978080" },
    { name: "white mask retained", mask: "white", expected: "4052405240528080" },
    { name: "black mask permits conversion", mask: "black", expected: "558a558a558a8080" },
    { name: "mask removed before conversion", mask: "gray50", before: ["+write-mask"], expected: "558a558a558a8080" },
    { name: "opaque source", mask: "gray50", color: "#b03775ff", expected: "558a558a558affff" },
    { name: "no mask", expected: "558a558a558a8080" },
])(`${mode}, ${width} pixels: $name`, async ({ mask, before = [], after = [], color = "#b0377580", expected }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-size", `${width}x1`, `xc:${color}`, "-colorspace", "Gray",
        ...(mask ? ["-write-mask", `xc:${mask}`] : []), ...before,
        "-colorspace", "sRGB", ...after, "-depth", "16", "-endian", "MSB", "rgba:-"];
    const argumentValues = createCommandArguments(argv);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(width));
});
