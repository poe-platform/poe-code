import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI with the same inline translucent pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    [[], "0x1", "2c234b6fad8a98d1"],
    [[], "0x2", "17123e67b28f9bd9"],
    [[], "%[fx:0]x2", "17123e67b28f9bd9"],
    [["-set", "option:s", "2"], "0x%[option:s]", "17123e67b28f9bd9"],
    [["-set", "spread", "2"], "0x%[spread]", "17123e67b28f9bd9"],
    [[], "0x%[fx:w]", "17123e67b28f9bd9"],
    [["-set", "option:s", "(0,2)"], "%[option:s]", "17123e67b28f9bd9"],
] as const)(`expands sharpen geometry before parsing (${mode}): %j %s`, async (settings, geometry, expected) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#50406080", "xc:#a08090c0", "+append", ...settings, "-sharpen", geometry, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }), stderr } : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const diagnostic = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
