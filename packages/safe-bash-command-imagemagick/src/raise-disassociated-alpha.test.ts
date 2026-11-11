import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI discards disassociated alpha even
// in the untouched interior. Active alpha is still shaded along the bevel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", bevel: [], after: [], channelsOnly: true, expected: "srgb  4.0" },
        { alpha: "disassociate", bevel: [], after: ["-alpha", "activate"], channelsOnly: false, expected: "srgba 4.0|0.501961|0.501961|0.501961" },
        ...["-raise", "+raise"].flatMap(option => [
            { alpha: "disassociate", bevel: [option, "1"], after: [], channelsOnly: true, expected: "srgb  3.0" },
            { alpha: "disassociate", bevel: [option, "1"], after: ["-alpha", "activate"], channelsOnly: false, expected: "srgba 4.0|0|0|0" },
            { alpha: "disassociate", bevel: [option, "1"], after: ["-alpha", "on"], channelsOnly: false, expected: "srgba 4.0|1|1|1" },
            { alpha: "on", bevel: [option, "1"], after: [], channelsOnly: false,
                expected: option === "-raise" ? "srgba 4.0|0.501961|0.736332|0.265744" : "srgba 4.0|0.501961|0.265744|0.736332" },
            ...["associate", "deactivate"].map(alpha => ({
                alpha, bevel: [option, "1"], after: ["-alpha", "activate"], channelsOnly: false,
                expected: "srgba 4.0|0.501961|0.501961|0.501961"
            }))
        ])
    ])(`${mode}: $alpha with $bevel and $after (channelsOnly=$channelsOnly)`, async ({ alpha, bevel, after, channelsOnly, expected }) => {
        const argv = ["-size", "5x5", "xc:#20406080", "-alpha", alpha, ...bevel, ...after,
            "-format", channelsOnly ? "%[channels]" : "%[channels]|%[fx:p{2,2}.a]|%[fx:p{2,0}.a]|%[fx:p{2,4}.a]", "info:"];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
