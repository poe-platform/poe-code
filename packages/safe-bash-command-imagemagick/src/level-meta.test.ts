import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = ["-size", "3x1", "xc:#505050", "-duplicate", "3", "(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit gray samples.
for (const mode of ["sync", "buffered", "retained", "command"] as const) for (const interval of ["25%,75%", "16383.75,49151.25"]) {
    it.each([
        { operator: "-level", channel: "Meta0", output: "Meta0", expected: "00818101ffff" },
        { operator: "+level", channel: "Meta0", output: "Meta0", expected: "60208040a060" },
        { operator: "-level", channel: "", output: "Meta0", expected: "00818101ffff" },
        { operator: "+level", channel: "", output: "Meta0", expected: "60208040a060" },
        { operator: "-level", channel: "All", output: "Meta0", expected: "40408080c0c0" },
        { operator: "-level", channel: "Meta1", output: "Meta1", expected: "c141c141c141" },
        { operator: "-level", channel: "R", output: "Meta0", expected: "40408080c0c0" },
        { operator: "+level", channel: "R", output: "Meta0", expected: "40408080c0c0" },
        { operator: "-level", channel: "Meta1", output: "Meta0", expected: "40408080c0c0" },
    ])(`${mode} ${interval}: $operator channel '$channel' extracts $output`, async ({ operator, channel, output, expected }) => {
        const args = [...input, ...(channel === "Meta1" ? ["-size", "3x1", "xc:#a0a0a0"] : []), "-combine",
            ...(channel ? ["-channel", channel] : []), operator, interval, "+channel", "-channel", output,
            "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
