import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI logical Gray channel selection.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["#808080c0", "A", "ffffffc0"],
        ["#808080c0", "R", "80808000"],
        ["#808080c0", "G", "ffffff00"],
        ["#808080c0", "", "808080c0"],
        ["#40802080", "", "6b6b6b80"],
        ["#40802080", "A", "ffffff80"],
        ["#40802080", "R", "6b6b6b00"],
        ["#40802080", "G", "ffffff00"],
    ])(`${mode}: applies Gray polynomial to %s with channel %s`, async (color, channel, expected) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = [`xc:${color}`, "-colorspace", "Gray",
            ...(channel ? ["-channel", channel] : []),
            "-poly", "1,1", "+channel", "-depth", "8", "rgba:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
