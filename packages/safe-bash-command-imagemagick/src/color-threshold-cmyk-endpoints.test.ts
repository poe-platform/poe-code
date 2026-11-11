import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI compares CMY endpoint components directly to sRGB samples.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { colors: ["red", "cyan"], range: "cmyk(100%,0%,0%,0%)-cmyk(100%,0%,0%,0%)", mask: [255, 0] },
        { colors: ["red", "cyan"], range: "cmyk(100%,0%,0%,100%)-cmyk(100%,0%,0%,100%)", mask: [255, 0] },
        { colors: ["#345caa"], range: "cmyk(0%,0%,0%,0%)-cmyk(100%,100%,100%,100%)", mask: [255] },
        { colors: ["red", "cyan"], range: "red-red", mask: [255, 0] },
        { colors: ["red", "cyan"], range: "cyan-cyan", mask: [0, 255] },
    ])(`${mode}: selects sRGB $colors with $range`, async ({ colors, range, mask }) => {
        const argv = [...colors.map(color => `xc:${color}`), "+append", "-color-threshold", range, "-depth", "8", "gray:-"];
        const fs = new MemoryFileSystem();
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(...result.stdoutBytes);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toEqual(mask);
    });
}
