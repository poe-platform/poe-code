import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps extracted planes Gray after -combine.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const output of ["info", "rgba"] as const)
it.each([
    { input: "#12457890", space: "RGB", channel: "R", rgba: "020202ff" },
    { input: "#12457890", space: "RGB", channel: "G", rgba: "0f0f0fff" },
    { input: "#12457890", space: "RGB", channel: "A", rgba: "909090ff" },
    { input: "#808080", space: "LinearGray", channel: "R", rgba: "373737ff" },
    { input: "#12457890", space: "sRGB", channel: "R", rgba: "121212ff" },
    { input: "#12457890", space: "sRGB", channel: "A", rgba: "909090ff" }
])(`${mode}: recombines $space $channel as Gray (${output})`, async ({ input, space, channel, rgba }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = [`xc:${input}`, "-colorspace", space, "-channel", channel, "-separate", "+channel", "-combine",
        ...(output === "info" ? ["-format", "%[colorspace]|%[channels]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"))
        .toBe(output === "info" ? "Gray|gray  1.0" : rgba);
});
