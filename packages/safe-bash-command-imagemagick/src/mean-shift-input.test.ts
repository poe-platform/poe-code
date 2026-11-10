import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const)
it.each(["before input", "after delete", "empty group", "after input", "control"])(`requires a current image for mean shift (%s, ${mode})`, async placement => {
    const input = ["xc:#10203012", "xc:#8090a093", "xc:#a0b0d0b5", "+append"];
    const operation = ["-mean-shift", "3x3+150%"];
    const valid = placement === "after input" || placement === "control";
    const args = placement === "before input" ? [...operation, ...input]
        : placement === "after delete" ? [...input, "+delete", ...operation, ...input]
        : placement === "empty group" ? [...input, "(", ...operation, ...input, ")"]
        : placement === "after input" ? [...input, "-set", "option:win", "3x3+150%", ...operation]
        : [...input, "-colorspace", "sRGB", "+channel", "-colorspace", "sRGB"];
    args.push("-depth", "8", "rgba:out");
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out", original]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", original);
    let stdout = "", stderr = "";
    const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect.soft(result.exitCode).toBe(valid ? 0 : 1);
    expect.soft(result.stdout).toBe("");
    expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-mean-shift'\n");
    const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
    // ImageMagick 7.1.2 Q16-HDRI: complete 8-bit RGBA output, or the unchanged destination.
    expect.soft(Buffer.from(output).toString("hex")).toBe(placement === "after input" ? "2636465f708093b39aaac6e1" : placement === "control" ? "102030128090a093a0b0d0b5" : "4b454550");
});
