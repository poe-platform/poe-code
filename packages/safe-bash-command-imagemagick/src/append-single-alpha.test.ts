import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick activates alpha for transparent append backgrounds, even without padding.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
for (const background of ["none", "white"])
for (const separate of [false, true])
for (const inactive of [false, true])
it(`${mode} ${direction}: single image, ${background}, separate=${separate}, inactive=${inactive}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [...(inactive ? ["xc:#ff000080", "-alpha", "off"] : ["xc:red"]), "-background", background, direction,
        ...(separate ? ["-separate"] : []),
        "-format", separate ? "%wx%h;" : "%[channels]|%[opaque]", "info:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(new TextDecoder().decode(bytes)).toBe(separate
        ? "1x1;".repeat(background === "none" ? 4 : 3)
        : background === "none" ? "srgba 4.0|True" : "srgb  3.0|True");
});
