import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference output.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Uint8Array.from([1, 2, 3, 1, 4, 2, 1, 4, 4, 3, 3, 2, 1, 3, 4].flatMap(i => [i * 40, i * 20, 255 - i * 30]))]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["-maximum", "+maximum", "-minimum", "+minimum"].flatMap(option =>
            [false, true].map(grouped => ({ option, grouped, expected: "" }))),
        { option: "Maximum", grouped: false, expected: "5028e1a050e1a050e1a050e1a050e1783ce1a050e1a050e1a050e1a050e1783ce1a050e1a050e1a050e1a050a5" },
        { option: "Minimum", grouped: false, expected: "2814c32814872814872814872814872814a52814872814872814872814872814a5281487281487281487783c87" }
    ])(`${mode}: matches native $option status and output (grouped=$grouped)`, async ({ option, grouped, expected }) => {
        const deprecated = option.startsWith("-") || option.startsWith("+");
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...(grouped ? ["("] : []),
            ...(deprecated ? [option] : ["-statistic", option, "3"]),
            ...(grouped ? [")"] : []), "-depth", "8", "rgb:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(deprecated ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(deprecated
            ? `magick: option deprecated, unable to execute '${option}' at CLI arg ${grouped ? 3 : 2}\n` : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(expected);
    });
}
