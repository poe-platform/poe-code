import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const mask = Buffer.from("00ff00ffff0000000000ffff", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: wave and spread clear Meta0 for fully transparent input.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const depth of [8, 16])
for (const output of ["samples", "info"])
it.each([
    { options: [], height: 3 },
    { options: ["-wave", "1x4"], height: 5 },
    { options: ["-wave", "0x4"], height: 3 },
    { options: ["-seed", "17", "-spread", "2"], height: 3 },
])(`${mode}, ${depth}-bit ${output}: retains Meta0 at output dimensions for $options`, async ({ options, height }) => {
    const input = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), mask]);
    const files = new Map([["/mask.pgm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/mask.pgm", input);
    const argv = [
        "-size", "4x3", "xc:black", "-duplicate", "3", "/mask.pgm", "-combine",
        ...options, ...(output === "info" ? ["-format", "%wx%h|%[channels]", "info:-"]
            : ["-channel", "Meta0", "-separate", "+channel", "-depth", String(depth), "gray:-"]),
    ];
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
    if (output === "info") {
        expect(mode === "command" ? Buffer.concat(chunks).toString() : "stdout" in result ? result.stdout : "").toBe(`4x${height}|srgba 5.1`);
        return;
    }
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
    const expected = options.length ? new Uint8Array(4 * height * depth / 8)
        : depth === 8 ? mask : Uint8Array.from([...mask].flatMap(value => [value, value]));
    expect(Array.from(bytes ?? [])).toEqual(Array.from(expected));
});

// Native ImageMagick 7.1.2-35 Q16-HDRI, single-threaded seed 42.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alpha of ["white", "gray50", "black"])
for (const output of ["samples", "info"])
it.each([
    { options: [], hex: "00000000008080808080ffffffffff", height: 3 },
    { options: ["-wave", "0x4"], hex: "00000000008080808080ffffffffff", height: 3 },
    { options: ["-wave", "1x4"], hex: "00000000000000008000800080ff80ff80ff00ff00ff000000", height: 5 },
    { options: ["-spread", "2"], hex: "0000ff51fdffee00eaafb3ff45e414", height: 3 },
])(`${mode}, alpha=${alpha}, ${output}: preserves Meta0 for $options`, async ({ options, hex, height }) => {
    const argv = ["-limit", "thread", "1", "-seed", "42", "-size", "5x3",
        "xc:black", "xc:black", "xc:black", `xc:${alpha}`, "gradient:black-white", "-combine",
        ...options, ...(output === "info" ? ["-format", "%wx%h|%[channels]", "info:-"]
            : ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"])];
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    if (output === "info") {
        expect(mode === "command" ? Buffer.concat(chunks).toString() : "stdout" in result ? result.stdout : "").toBe(`5x${height}|srgba 5.1`);
        return;
    }
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
    expect(Buffer.from(bytes ?? []).toString("hex")).toBe(alpha === "black" && options.length ? "00".repeat(5 * height) : hex);
});
