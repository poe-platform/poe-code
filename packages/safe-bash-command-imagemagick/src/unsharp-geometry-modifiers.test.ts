import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: geometry decorations leave the pixel result unchanged.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    "0x2+0.1+0", "(0x2+0.1+0)", "0x2+0.1+0!", "0x2+0.1+0%",
    "0x2+0.1+0<", "0x2+0.1+0>", "0x2+0.1+0^", "0x2+0.1+0@", "0x2+0.1+0#",
    "(0x2+0.1+0)!%", "bad", "(bad)!%"
])(`handles unsharp geometry decorations (${mode}): %s`, async geometry => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#504060", "xc:#a08090", "+append", "-unsharp", geometry, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if (geometry.includes("bad")) {
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain("Invalid unsharp geometry");
        if (mode === "command" || mode === "retained") await expect(fs.readFile("/out")).rejects.toThrow();
        else expect(files.has("/out")).toBe(false);
        return;
    }
    expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe("4d3d5effa38392ff");
});
