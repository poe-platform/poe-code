import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const respectParentheses of [false, true]) {
    it.each([
        { channel: "", color: "#33669980", depth: "8", background: "ffffff00", pixel: "33669980" },
        { channel: "R", color: "#33669980", depth: "8", background: "ffffff00", pixel: "33ffff00" },
        { channel: "G", color: "#33669980", depth: "8", background: "ffffff00", pixel: "ff66ff00" },
        { channel: "A", color: "#33669980", depth: "8", background: "ffffff00", pixel: "ffffff80" },
        { channel: "RGB", color: "#33669980", depth: "8", background: "ffffff00", pixel: "33669900" },
        { channel: "RGBA", color: "#33669980", depth: "8", background: "ffffff00", pixel: "33669980" },
        { channel: "R", color: "#123456789abc8000", depth: "16", background: "ffffffffffff0000", pixel: "1234ffffffff0000" },
    ])(`${mode}: Dispose preserves unselected channels ($channel, $depth-bit, respectParentheses=${respectParentheses})`, async ({ channel, color, depth, background, pixel }) => {
        // The red-only and RGBA cases reproduce ImageMagick 7.1.2-35 Q16-HDRI bytes.
        const argv = [...(respectParentheses ? ["-respect-parentheses"] : []),
            "(", "-size", "2x1", `xc:${color}`, ...(channel ? ["-channel", channel] : []), "-repage", "3x1+1+0", ")",
            "-layers", "Dispose", "+channel", "-depth", depth, "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(background + pixel.repeat(2));
    });
}
