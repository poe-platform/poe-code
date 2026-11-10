import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const factor of [1, 2, 3])
for (const channel of ["10", "R"])
it(`${mode}: magnify ${factor}x preserves channel ${channel}'s complete raster`, async () => {
    const args = ["-size", "2x1", "xc:black", "xc:black", "xc:black", "xc:white", "gradient:black-white", "-combine",
        ...(factor === 1 ? [] : factor === 2 ? ["-magnify"] : ["-define", "magnify:method=scale3x", "-magnify"]),
        "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // ImageMagick 7.1.2 Q16-HDRI repeats the fifth channel in both axes.
    expect(Buffer.from(output).toString("hex")).toBe(("00".repeat(factor) + (channel === "10" ? "ff" : "00").repeat(factor)).repeat(factor));
});
