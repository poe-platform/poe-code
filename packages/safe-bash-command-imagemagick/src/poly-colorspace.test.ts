import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output, including the sRGB control.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["HSL", "33b820b7"],
        ["Lab", "935269b7"],
        ["XYZ", "8e5282b7"],
        ["HWB", "33b820b7"],
        ["sRGB", "705068b7"],
    ])(`${mode}: converts polynomial results from %s to sRGB`, async (space, expected) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["xc:#2060b080", "xc:#c04020ed", "-colorspace", space,
            "-poly", ".5,1,.5,1", "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
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
