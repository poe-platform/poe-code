import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI on 64-bit Linux.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1x3+2+1", "3x1 1.8446744073709552e+19,1,+2,+1"],
        ["3x1+2+1", "3x1 1,1.8446744073709552e+19,+2,+1"],
        ["2x2+0+0", "3x1 0,0,+0,+0"],
        ["9x7+2+1", "3x1 7,5,+2,+1"],
    ])(`formats shaved page dimensions for %s (${mode})`, async (page, expected) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const args = ["-size", "5x3", "xc:blue", "-repage", page, "-shave", "1x1", "-format", "%wx%h %W,%H,%X,%Y", "info:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
