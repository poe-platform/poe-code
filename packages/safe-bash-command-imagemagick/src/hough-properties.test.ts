import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2: Hough images start without source properties,
// while explicit density and units settings still apply to the result.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { options: [], expected: "source|memo|original|40|60|PixelsPerInch;", warning: false },
        { options: ["-hough-lines", "1x1+3"], expected: "|||40|60|PixelsPerInch;", warning: true },
        { options: ["-define", "hough-lines:accumulator=true", "-hough-lines", "1x1+3"], expected: "|||40|60|PixelsPerInch;|||40|60|PixelsPerInch;", warning: true },
        { options: ["-hough-lines", "1x1+3", "-set", "label", "result", "-set", "comment", "new", "-set", "note", "updated"], expected: "result|new|updated|40|60|PixelsPerInch;", warning: false }
    ])(`handles Hough image properties (${mode}): $options`, async ({ options, expected, warning }) => {
        const fs = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:black", "-set", "label", "source", "-set", "comment", "memo", "-set", "note", "original",
            "-background", "black", "-units", "PixelsPerInch", "-density", "40x60", ...options,
            "-format", "%l|%c|%[note]|%x|%y|%U;", "info:"];
        let result;
        if (mode === "public") {
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args,
                cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result).toMatchObject({ exitCode: 0, stdout: expected });
        if (warning) expect(result.stderr).toContain("magick: unknown image property '%[note]'\n");
        else expect(result.stderr).toBe("");
    });
}
