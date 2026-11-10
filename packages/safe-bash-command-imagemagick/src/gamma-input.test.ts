import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(["-gamma", "+gamma"])(`${mode}: requires a current image for %s and preserves output on failure`, async option => {
        for (const placement of ["before", "deleted", "after"] as const) {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out", original]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", original);
            const input = "xc:#4080c080";
            const args = [...(placement === "after" ? [input, option, "2"] : [
                ...(placement === "deleted" ? [input, "+delete"] : []), option, "2", input
            ]), "-depth", "8", "rgba:out"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("out") : await fs.readFile("/out");
            expect.soft(result.exitCode).toBe(placement === "after" ? 0 : 1);
            expect.soft(result.stdout).toBe("");
            if (placement === "after") {
                expect.soft(result.stderr).toBe("");
                expect.soft(output).toEqual(Uint8Array.from(option === "-gamma" ? [128, 181, 221, 181] : [16, 64, 145, 64]));
            } else {
                expect.soft(result.stderr).toContain(`no images found for operation '${option}'`);
                expect.soft(output).toEqual(original);
            }
        }
    });
}
