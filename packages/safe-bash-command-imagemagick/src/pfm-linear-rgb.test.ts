import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact binary32 words from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [[], ["-depth", "16"]]) for (const endian of ["LSB", "MSB"]) {
        it.each([
            { color: "#4682b4", words: [0x3d7add25, 0x3e6495df, 0x3ee9aeb5] },
            { color: "#6090e0", words: [0x3def8e52, 0x3e8ecb3b, 0x3f3ed2d0] },
            { color: "#123456", words: [0x3bc6354a, 0x3d0ca7e6, 0x3dbe95b3] },
        ])(`${mode}, ${depth.join(" ")}, ${endian}: preserves linear RGB PFM rounding for $color`, async ({ color, words }) => {
            const args = [`xc:${color}`, "-colorspace", "RGB", ...depth, "-endian", endian, "pfm:-"];
            const fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(args);
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout));
            const header = `PF\n1 1\n${endian === "LSB" ? "-1.0" : "1.0"}\n`;
            expect(output.subarray(0, -12).toString()).toBe(header);
            const samples = output.subarray(-12);
            expect([0, 4, 8].map(offset => endian === "LSB" ? samples.readUInt32LE(offset) : samples.readUInt32BE(offset))).toEqual(words);
        });
    }
}

it.each([
    { space: "sRGB", format: "pfm", hex: "3e8c8c8d3f0282833f34b4b5" },
    { space: "RGB", format: "phm", hex: "2bd73325374d" },
])("preserves the matching $space $format control", ({ space, format, hex }) => {
    const result = runMagickCliSync(["xc:#4682b4", "-colorspace", space, "-endian", "MSB", `${format}:-`], new Map());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(Buffer.from(result.stdoutBytes!).subarray(-hex.length / 2).toString("hex")).toBe(hex);
});
