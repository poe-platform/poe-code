import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with the same inline two-pixel input.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    [[], "0x%[fx:1+1]+0.1+0", "4d3d5effa38392ff"],
    [["-set", "option:spread", "2"], "0x%[option:spread]", "30264dffc09aa3ff"],
    [["-set", "spread", "2"], "0x%[spread]", "30264dffc09aa3ff"],
    [[], "0x%[fx:w]+0.1+0", "4d3d5effa38392ff"],
    [["-set", "option:spread", "bad"], "0x%[option:spread]", undefined]
] as const)(`expands unsharp geometry before parsing (${mode}): %j %s`, async (settings, geometry, expected) => {
    const sentinel = new Uint8Array([1, 2, 3]);
    const fs = new MemoryFileSystem(), files = new Map([["/out", sentinel]]);
    await fs.writeFile("/out", sentinel);
    const argv = ["xc:#504060", "xc:#a08090", "+append", ...settings, "-unsharp", geometry, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const diagnostic = "stderr" in result ? result.stderr : stderr;
    expect(result.exitCode, diagnostic).toBe(expected === undefined ? 1 : 0);
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    if (expected === undefined) {
        expect(diagnostic).toContain("Invalid unsharp geometry");
        expect(bytes).toEqual(sentinel);
    } else {
        expect(diagnostic).toBe("");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    }
});
