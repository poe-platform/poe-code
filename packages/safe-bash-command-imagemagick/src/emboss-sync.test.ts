import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { channel: undefined, expected: "ff0000000000ff0000ff00ff" },
        { channel: "Default", expected: "ff0000000000ff0000ff00ff" },
        { channel: "RGB,Sync", expected: "ff0000800000ffa000ff00f0" },
        { channel: "RGBA", expected: "ff0000558080ffaa00ff00ff" },
    ])(`${mode}: emboss with $channel channels`, async ({ channel, expected }) => {
        const argv = ["xc:#a2403980", "xc:#4094dfa0", "xc:#15c037f0", "+append",
            ...(channel ? ["-channel", channel] : []), "-emboss", "2x1", "+channel", "-depth", "8",
            mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
