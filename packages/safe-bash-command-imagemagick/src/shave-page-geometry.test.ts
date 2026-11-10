import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI on 64-bit Linux.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { size: "5x4", page: "2x2-1-1", shave: "2x0", dimensions: "1.8446744073709552e+19x2", offset: "-1-1", numeric: "1.8446744073709552e+19,2" },
        { size: "5x3", page: "3x1+2+1", shave: "1x1", dimensions: "1x1.8446744073709552e+19", offset: "+2+1", numeric: "1,1.8446744073709552e+19" },
        { size: "5x3", page: "2x2+0+0", shave: "1x1", dimensions: "0x0", offset: "+0+0", numeric: "0,0" },
        { size: "5x3", page: "9x7+2+1", shave: "1x1", dimensions: "7x5", offset: "+2+1", numeric: "7,5" },
    ])(`formats shaved page geometry consistently for $page (${mode})`, async ({ size, page, shave, dimensions, offset, numeric }) => {
        for (const [format, expected] of [
            ["%P/%g/%[page]", `${dimensions}/${dimensions}${offset}/${dimensions}`],
            ["%W,%H", numeric],
        ] as const) {
            const filesystem = new MemoryFileSystem();
            const args = ["-size", size, "xc:red", "-repage", page, "-shave", shave, "-format", format, "info:-"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
                .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        }
    });
}
