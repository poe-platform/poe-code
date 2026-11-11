import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with a translucent source pixel.
for (const mode of ["command", "buffered", "sync"] as const) it.each([
    { border: "#22883380", hash: "f36f6a999ec3793459a8f9c7a0742b8da76befd62442461312817c2b2cebcc74" },
    { border: "#228833", hash: "ec4b8d05377e28c977c1762e84a3edc8a240a184e4c97dffd1f6bb3c2ea2882b" },
    { border: undefined, hash: "5cd92ae56dc8406d171a6f7d913f3d605c63a9968760101a151b1a9a69c9fab2" },
    { border: "none", hash: "e62d7ca7d4ef0546948c7477c79c288f8b19be6b4def04c5d29200a910260ea7" },
    { border: "none", format: "%wx%h|%g", expected: "29x29|29x29+0-1" },
])(`${mode}: matches native polaroid border $border`, async ({ border, hash, format, expected }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-seed", "7", "xc:#ac593e80", ...(border === undefined ? [] : ["-bordercolor", border]), "-polaroid", "0",
        ...(format ? ["-format", format, "info:out"] : ["-depth", "8", "rgba:out"])];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files) : mode === "buffered" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
    });
    expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
    const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
    if (format) expect(new TextDecoder().decode(output)).toBe(expected);
    else {
        expect(output.byteLength).toBe(3364);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    }
});
