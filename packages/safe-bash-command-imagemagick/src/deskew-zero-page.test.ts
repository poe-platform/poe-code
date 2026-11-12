import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"]) {
    it.each([
        { page: "7x0+0+0", deskew: true, expected: "5x5|12x0-1-1" },
        { page: "0x8+0+0", deskew: true, expected: "5x5|0x13-1-1" },
        { page: "0x0+0+0", deskew: true, expected: "5x5|0x0-1-1" },
        { page: "7x8+0+0", deskew: true, expected: "5x5|12x13-1-1" },
        { page: "7x0+0+0", deskew: false, expected: "3x3|7x0+0+0" },
    ])(`preserves native page geometry $page with deskew=$deskew (${mode})`, async ({ page, deskew, expected }) => {
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "3x3", "gradient:#334411-#77aaee", "-repage", page,
            ...(deskew ? ["-deskew", "0%"] : []), "-format", "%wx%h|%g", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, new Map())
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}
