import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI retains disabled alpha storage.
const types = [
    { type: "TrueColor", rgb: "007733", rgb16: "000077773333", alpha: "40", channels: "srgb  4.0", midpoint: "55669960" },
    { type: "Grayscale", rgb: "595959", rgb16: "225922592259", alpha: "40", channels: "gray  2.0", midpoint: "8157ac60" },
    { type: "Bilevel", rgb: "000000", rgb16: "000000000000", alpha: "ff", channels: "gray  3.0", midpoint: "552b80c0" },
    { type: "Palette", rgb: "007733", rgb16: "000077773333", alpha: "40", channels: "srgb  5.0", midpoint: "55669960" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const { type, rgb, rgb16, alpha, channels, midpoint } of types)
it.each([
    { name: "opaque output", argv: ["xc:#00773340", "-type", type, "-depth", "8", "rgba:-"], expected: rgb + "ff" },
    { name: "reactivated alpha", argv: ["xc:#00773340", "-type", type, "-alpha", "activate", "-depth", "8", "rgba:-"], expected: rgb + alpha },
    { name: "already inactive alpha", argv: ["xc:#00773340", "-alpha", "deactivate", "-type", type, "-alpha", "activate", "-depth", "8", "rgba:-"], expected: rgb + alpha },
    { name: "removed alpha", argv: ["xc:#00773340", "-alpha", "off", "-type", type, "-alpha", "activate", "-depth", "8", "rgba:-"], expected: rgb + "00" },
    { name: "new opaque alpha", argv: ["xc:#00773340", "-type", type, "-alpha", "on", "-depth", "8", "rgba:-"], expected: rgb + "ff" },
    { name: "stored channels", argv: ["xc:#00773340", "-type", type, "-format", "%[channels]", "info:"], expected: channels, text: true },
    { name: "morph midpoint", argv: ["xc:#aa55ff80", "(", "xc:#00773340", "-type", type, ")", "-morph", "1", "-delete", "0,2", "-depth", "8", "rgba:-"], expected: midpoint },
    { name: "16-bit reactivation", argv: ["xc:#0000777733334041", "-type", type, "-alpha", "activate", "-depth", "16", "-endian", "LSB", "rgba:-"], expected: rgb16 + (type === "Bilevel" ? "ffff" : "4140") },
])(`${mode}: ${type} $name`, async ({ argv, expected, text = false }) => {
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
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
        : text && "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
    expect(output.toString(text ? "utf8" : "hex")).toBe(expected);
});
