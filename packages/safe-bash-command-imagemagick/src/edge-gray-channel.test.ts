import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8: Gray has only the red/gray channel.
for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each([
    { channel: "R", expected: "000000c0c0c0" },
    { channel: "G", expected: "505050909090" },
    { channel: "B", expected: "505050909090" },
    { channel: undefined, expected: "000000c0c0c0" },
])(`${mode}: edge respects the logical Gray channel ($channel)`, async ({ channel, expected }) => {
    const fs = new MemoryFileSystem();
    const args = ["xc:#505050", "xc:#909090", "+append", "-colorspace", "Gray",
        "-seed", "3", "-virtual-pixel", "edge", ...(channel ? ["-channel", channel] : []),
        "-edge", "1", "+channel", "-depth", "8", "rgb:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "magick" || mode === "convert"
        ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    if ("stderr" in result) stderr = String(result.stderr);
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
