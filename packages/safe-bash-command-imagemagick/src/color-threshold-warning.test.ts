import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI stops parsing at the first unknown endpoint.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "red", range: "red-red", settings: [], pixel: 255, warning: false },
        { color: "red", range: "red-foo", settings: [], pixel: 0, warning: true },
        { color: "red", range: "foo-red", settings: [], pixel: 0, warning: true },
        { color: "black", range: "foo-bar", settings: [], pixel: 255, warning: true },
        { color: "black", range: "black-foo", settings: [], pixel: 255, warning: true },
        { color: "black", range: "red-foo", settings: [], pixel: 0, warning: true },
        { color: "red", range: "red-foo", settings: ["-quiet"], pixel: 0, warning: false },
        { color: "red", range: "red-foo", settings: ["-regard-warnings"], pixel: 0, warning: true },
    ])(`${mode}: xc:$color -color-threshold $range $settings`, async ({ color, range, settings, pixel, warning }) => {
        const argv = [`xc:${color}`, ...settings, "-color-threshold", range, "-depth", "8", "gray:-"];
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
        if ("stdoutBytes" in result && result.stdoutBytes) stdout.push(...result.stdoutBytes);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toEqual([pixel]);
        expect(stderr).toBe(warning ? "magick: unrecognized color `foo'\n" : "");
    });
}
