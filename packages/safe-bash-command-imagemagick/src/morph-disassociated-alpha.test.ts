import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: generated frames lose the
// disassociated alpha separation trait, while the endpoints retain it.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { count: "1", reverse: false, extract: false, depth: "8", expected: "2000c0" },
    { count: "1", reverse: true, extract: false, depth: "8", expected: "c00020" },
    { count: "2", reverse: false, extract: false, depth: "16", expected: "202020202020ffff000000000000ffff000000000000ffffc0c0c0c0c0c0ffff" },
    { count: "1", reverse: false, extract: true, depth: "8", expected: "ffffff" },
    { count: "0", reverse: false, extract: false, depth: "16", expected: "202020202020ffffc0c0c0c0c0c0ffff" },
    { count: "1", activate: true, secondAlpha: false, expected: "ffffff20ffffe0002080c0c0" },
    { count: "2", activate: true, expected: "ffffff20ffffff00ffffff002baaffc0" },
    { count: "0", activate: true, secondAlpha: false, expected: "ffffff202080c0c0" },
    { count: "1", activate: true, secondAlpha: false, png: true, expected: "ffffe000" },
    { count: "1", activate: true, secondAlpha: false, filter: "Triangle", expected: "ffffff20ffffe0002080c0c0" },
    { count: "1", activate: true, filter: "Triangle", expected: "ffffff20ffffff002baaffc0" },
    { count: "1", activate: true, secondAlpha: false, depth: "16", expected: "ffffffffffff2020ffffffffe060000020208080c0c0c0c0" },
    { count: "1", activate: true, secondAlpha: false, secondSize: "3x1", expected: "ffffff20ffffe000ffffe0002080c0c02080c0c02080c0c0" },
    { count: "1", activate: true, secondAlpha: false, alpha: "Deactivate", expected: "80402020506070c02080c0c0" },
    { count: "1", activate: true, secondAlpha: false, alpha: "Associate", expected: "10080420184462c02080c0c0" },
])(`${mode}: disassociated morph %j`, async ({ count, reverse = false, extract = false, depth = "8", activate = false, secondAlpha = true, png = false, filter, secondSize, alpha = "Disassociate", expected }) => {
    const colors = reverse ? ["#2080c0c0", "#80402020"] : ["#80402020", "#2080c0c0"];
    const argv = [
        ...(filter ? ["-filter", filter] : []),
        ...colors.flatMap((color, index) => ["(", ...(index === 1 && secondSize ? ["-size", secondSize] : []), `xc:${color}`, ...(index === 0 || secondAlpha ? ["-alpha", alpha] : []), ")"]),
        "-morph", count,
        ...(png ? ["-delete", "0,2"] : []),
        ...(activate ? ["-alpha", "Activate"] : extract ? ["-alpha", "extract"] : ["-channel", "A", "-separate", "+channel"]),
        "-depth", depth, "-endian", "MSB", png ? "PNG32:-" : activate || depth === "16" ? "rgba:-" : "gray:-",
    ];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
