import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference output.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Uint8Array.from([1, 2, 3, 1, 4, 2, 1, 4, 4, 3, 3, 2, 1, 3, 4].flatMap(i => [i * 40, i * 20, 255 - i * 30]))]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([{ quiet: false, option: "-gaussian" }, { quiet: true, option: "-gaussian" }, { quiet: false, option: "-gaussian-blur" }])(`${mode}: matches native $option (quiet=$quiet)`, async ({ quiet, option }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = [...(quiet ? ["-quiet"] : []), "/in.ppm", option, "3", "-depth", "8", "rgb:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map([["/in.ppm", input]]))
            : await runMagickCli(argv, mode === "buffered" ? new Map([["/in.ppm", input]]) : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(option === "-gaussian" ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(option === "-gaussian-blur" ? "" :
            (quiet ? "" : `magick: option has been replaced '-gaussian', use "-gaussian-blur" at CLI arg 2\n`)
            + `magick: unrecognized option '-gaussian' at CLI arg ${quiet ? 3 : 2}\n`);
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(option === "-gaussian" ? "" : "3e1fd04f28c46130b66d36ad82419d4e27c4532ac06432b4773ba686439a5f30b7552bbf5c2eba753ba78c4696");
    });
}
