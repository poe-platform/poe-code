import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Gray Hald output aliases all RGB channels,
// including when only alpha is selected. Negating the cube verifies lookup writes.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const negate of [false, true])
for (const channel of ["R", "G", "B", "A", "RGB"])
it(`${mode}: Gray Hald with ${channel} selected before lookup, negate=${negate}`, async () => {
    const argv = ["xc:#4287ba83", "-channel", channel, "(", "hald:2", "-colorspace", "Gray",
        ...(negate ? ["+channel", "-negate", "-channel", channel] : []), ")", "-hald-clut", "+channel",
        "-depth", "8", "-write", "rgba:/out", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:"];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let stdout = "", stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: `Gray|graya 2.0|graya(${negate ? 189 : 66},${channel === "A" ? 1 : "0.513725"})`, stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe((negate ? "bdbdbd" : "424242") + (channel === "A" ? "ff" : "83"));
});
