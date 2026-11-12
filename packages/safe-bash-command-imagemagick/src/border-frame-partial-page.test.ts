import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: decoration expands only complete pages.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { page: "7x0+0+0", decorated: "7x0+0+0", shaved: "1x1+0+0" },
        { page: "0x8+0+0", decorated: "0x8+0+0", shaved: "1x1+0+0" },
        { page: "7x8+0+0", decorated: "9x10+0+0", shaved: "5x6+0+0" },
        { page: "0x0+0+0", decorated: "0x0+0+0", shaved: "1x1+0+0" },
    ])(`${mode}: preserves partial pages through decoration and resets them through shave ($page)`, async ({ page, decorated, shaved }) => {
        for (const { options, expected } of [
            { options: [], expected: `3x3|${page}` },
            { options: ["-border", "1"], expected: `5x5|${decorated}` },
            { options: ["-frame", "1x1"], expected: `5x5|${decorated}` },
            { options: ["-shave", "1x1"], expected: `1x1|${shaved}` },
        ]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["-size", "3x3", "gradient:#334411-#77aaee", "-repage", page,
                ...options, "-format", "%wx%h|%g", "info:"];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout,
                stderr: "stderr" in result ? result.stderr : stderr }, argv.join(" "))
                .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        }
    });
}
