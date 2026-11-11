import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes after reactivating stored alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["discrete", "A", "32406070"],
        ["deactivate", "A", "32406080"],
        ["on", "A", "32406070"],
        ["off", "A", "32406000"],
        ["discrete", "RGB", "22305080"],
        ["discrete", "Default", "22305070"],
    ])(`${mode}: despeckle with alpha %s and channel %s`, async (alpha, channel, expected) => {
        const args = ["xc:#32406080", "-alpha", alpha, "-channel", channel,
            "-despeckle", "+channel", "-alpha", "activate", "-depth", "8", "rgba:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
