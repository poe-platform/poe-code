import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Inspect the frame list before encoding so GIF optimization cannot hide a lost frame.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "different colors with disabled zero alpha", first: "ff000000", second: "0000ff00", firstAlpha: ["off"], secondAlpha: ["off"], changed: true },
        { name: "identical colors with disabled and opaque alpha", first: "12345600", second: "123456ff", firstAlpha: ["off"], secondAlpha: [], changed: false },
        { name: "identical colors with opaque and disabled alpha", first: "123456ff", second: "12345600", firstAlpha: [], secondAlpha: ["off"], changed: false },
        { name: "different inactive alpha samples", first: "12345600", second: "12345680", firstAlpha: ["off"], secondAlpha: ["off"], changed: false },
        { name: "active transparent colors", first: "ff000000", second: "0000ff00", firstAlpha: [], secondAlpha: [], changed: false },
        { name: "active versus disabled transparency", first: "12345600", second: "12345600", firstAlpha: [], secondAlpha: ["off"], changed: true },
        { name: "identical opaque colors", first: "ff0000", second: "ff0000", firstAlpha: [], secondAlpha: [], changed: false },
        { name: "different opaque colors", first: "ff0000", second: "0000ff", firstAlpha: [], secondAlpha: [], changed: true },
    ])(`${mode} RemoveDups compares visible colors: $name`, async ({ first, second, firstAlpha, secondAlpha, changed }) => {
        const argv = ["(", "-delay", "3", `xc:#${first}`, ...firstAlpha.flatMap(alpha => ["-alpha", alpha]), ")",
            "(", "-delay", "5", `xc:#${second}`, ...secondAlpha.flatMap(alpha => ["-alpha", alpha]), ")",
            "-delay", "7", "xc:green", "-layers", "RemoveDups", "-format", "%wx%h%O:%T;", "info:"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout)
            .toBe(changed ? "1x1+0+0:3;1x1+0+0:5;1x1+0+0:7;" : "1x1+0+0:8;1x1+0+0:7;");
    });
}
