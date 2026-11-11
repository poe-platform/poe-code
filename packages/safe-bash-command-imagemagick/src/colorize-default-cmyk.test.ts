import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, C,M,Y,K,A or R,G,B,A bytes at depth 8.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { channel: [], strength: "0", output: "cmyka", expected: "ac006c5f80" },
        { channel: [], strength: "65%", output: "cmyka", expected: "c049532180" },
        { channel: [], strength: "100%", output: "cmyka", expected: "ca71460080" },
        { channel: [], strength: "65%", output: "rgba", expected: "379e9580" },
        { channel: ["-channel", "Default"], strength: "65%", output: "cmyka", expected: "c049532180" },
        { channel: ["-channel", "CMYK"], strength: "65%", output: "cmyka", expected: "c049532180" },
        { channel: ["-channel", "All"], strength: "65%", output: "cmyka", expected: "c049532180" },
        { channel: ["-channel", "CMY"], strength: "65%", output: "cmyka", expected: "c049535f80" },
        { channel: ["-channel", "K"], strength: "65%", output: "cmyka", expected: "ac006c2180" },
        { channel: ["-channel", "CMY", "+channel"], strength: "65%", output: "cmyka", expected: "c049532180" },
    ])(`${mode}: CMYK colorize $strength with $channel into $output`, async ({ channel, strength, output, expected }) => {
        const fs = new MemoryFileSystem();
        const args = ["xc:#34a05c80", "-colorspace", "CMYK", ...channel, "-fill", "#ca7146", "-colorize", strength,
            "+channel", ...(output === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${output}:-`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
