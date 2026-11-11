import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Discrete alpha interpolates,
// while deactivated alpha copies the second input's opacity.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { alpha: "Discrete", both: false, count: "1", output: ["-alpha", "Activate", "-depth", "8", "rgba:-"], expected: "80402020506070702080c0c0" },
    { alpha: "Discrete", both: true, count: "2", output: ["-alpha", "Extract", "-depth", "8", "rgba:-"], expected: "202020ff555555ff8b8b8bffc0c0c0ff" },
    { alpha: "Discrete", both: false, count: "1", output: ["-channel", "A", "-separate", "+channel", "-depth", "8", "rgba:-"], expected: "202020ff707070ffc0c0c0ff" },
    { alpha: "Discrete", both: false, count: "0", output: ["-alpha", "Activate", "-depth", "8", "rgba:-"], expected: "804020202080c0c0" },
    { alpha: "Deactivate", both: true, count: "1", output: ["-alpha", "Extract", "-depth", "8", "rgba:-"], expected: "202020ffc0c0c0ffc0c0c0ff" },
    { alpha: "Discrete", both: false, count: "1", output: ["-delete", "0,2", "-alpha", "Activate", "PNG32:-"], expected: "50607070" },
])(`${mode}: $alpha, both=$both, morph=$count, $output`, async ({ alpha, both, count, output, expected }) => {
    const argv = ["(", "xc:#80402020", "-alpha", alpha, ")", "(", "xc:#2080c0c0", ...(both ? ["-alpha", alpha] : []), ")", "-morph", count, ...output];
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
    expect(Buffer.from(output.at(-1) === "PNG32:-" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});

for (const mode of ["sync", "retained", "buffered"] as const)
for (const resized of [false, true])
for (const cmyk of [false, true])
it(`interpolates Discrete Q16 opacity (${mode}, resized=${resized}, cmyk=${cmyk})`, async () => {
    const argv = [
        "(", "xc:#8040404020202021", "-alpha", "Discrete", ")",
        "(", "-size", resized ? "3x3" : "1x1", "xc:#20208080c0c0c0c1", ")",
        ...(cmyk ? ["-colorspace", "CMYK"] : []),
        "-morph", "1", "-delete", "0,2", "-alpha", "Activate", "-channel", "A", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:-",
    ];
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("7071".repeat(resized ? 4 : 1));
});
