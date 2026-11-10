import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inactive opacity is copied from the second input.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { alpha: "deactivate", reverse: false, count: "1", output: ["-alpha", "extract", "-depth", "8", "gray:-"], expected: "20c0c0" },
    { alpha: "deactivate", reverse: true, count: "1", output: ["-alpha", "extract", "-depth", "8", "gray:-"], expected: "c02020" },
    { alpha: "associate", reverse: false, count: "1", output: ["-alpha", "extract", "-depth", "8", "gray:-"], expected: "20c0c0" },
    { alpha: "deactivate", reverse: false, count: "1", output: ["-alpha", "activate", "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "20c0c0" },
    { alpha: "deactivate", reverse: false, count: "1", output: ["-channel", "A", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "000000" },
    { alpha: "associate", reverse: false, count: "0", output: ["-alpha", "extract", "-depth", "16", "-endian", "MSB", "rgba:-"], expected: "202020202020ffffc0c0c0c0c0c0ffff" },
    { alpha: "deactivate", reverse: false, count: "2", output: ["-alpha", "extract", "-depth", "8", "gray:-"], expected: "20c0c0c0" },
])(`${mode}: $alpha, reverse=$reverse, morph=$count, $output`, async ({ alpha, reverse, count, output, expected }) => {
    const colors = ["xc:#80402020", "xc:#2080c0c0"];
    if (reverse) colors.reverse();
    const argv = [...colors.flatMap(color => ["(", color, "-alpha", alpha, ")"]), "-morph", count, ...output];
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
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});

for (const mode of ["sync", "retained", "buffered"] as const)
for (const resized of [false, true])
for (const cmyk of [false, true])
it(`copies inactive Q16 opacity through morph resizing (${mode}, resized=${resized}, cmyk=${cmyk})`, async () => {
    const argv = [
        "(", "xc:#8040404020202021", "-alpha", "deactivate", ")",
        "(", "-size", resized ? "3x3" : "1x1", "xc:#20208080c0c0c0c1", "-alpha", "deactivate", ")",
        ...(cmyk ? ["-colorspace", "CMYK"] : []),
        "-morph", "1", "-delete", "0,2", "-alpha", "activate", "-channel", "A", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:-",
    ];
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("c0c1".repeat(resized ? 4 : 1));
});
