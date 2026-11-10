import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("requires a current image for vignette and preserves the destination on failure (%s)", async mode => {
    const original = new TextEncoder().encode("KEEP");
    const input = ["-size", "6x4", "xc:#3876b4"];
    for (const position of ["before", "deleted", "group", "valid"] as const) {
        const valid = position === "valid";
        const files = new Map<string, Uint8Array>([["out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const args = [...position === "before" ? ["-vignette", "0x1", ...input]
            : position === "group" ? [...input, "(", "-vignette", "0x1", ")"]
            : position === "deleted" ? [...input, "+delete", "-vignette", "0x1", ...input]
            : [...input, "-background", "#d29153", "-vignette", "0x1+1+1"], "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-vignette'\n");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (valid) expect.soft(createHash("sha256").update(output).digest("hex")).toBe("314f060bb04451baf96b09d852fac618ba473a5538277034c7137226264a6c02");
        else expect.soft(output).toEqual(original);
    }
});
