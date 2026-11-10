import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI, complete cyan/magenta/yellow/black/alpha bytes.
    it.each([
        { channel: "K", clamp: true, expected: "4b550040c0" },
        { channel: "C", clamp: true, expected: "4055009cc0" },
        { channel: "CMYK", clamp: true, expected: "40400040c0" },
        { channel: "K", clamp: false, expected: "4b55009cc0" },
        { channel: "A", clamp: true, expected: "4b55009c40" },
        { channel: "CMYKA", clamp: true, expected: "4040004040" },
        { channel: "", clamp: true, expected: "4040004040" },
        { channel: "CMYK", clamp: true, before: ["subtract", "65535"], after: ["add", "16384"], expected: "40404040c0" },
    ])(`${mode}: clamps selected $channel samples before division (clamp=$clamp)`, async ({ channel, clamp, expected, before = ["multiply", "4"], after = ["divide", "4"] }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["xc:#464263c0", "-colorspace", "CMYK", ...(channel ? ["-channel", channel] : []),
            "-evaluate", ...before, ...(clamp ? ["-clamp"] : []),
            "-evaluate", ...after, "+channel", "-depth", "8", "cmyka:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
