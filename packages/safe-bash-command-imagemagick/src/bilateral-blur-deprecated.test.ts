import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, +bilateral-blur is deprecated; -bilateral-blur outputs 14202b506275.
const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { option: "+bilateral-blur", grouped: false },
        { option: "+bilateral-blur", grouped: true },
        { option: "-bilateral-blur", grouped: false }
    ])(`${mode}: matches native $option status and output (grouped=$grouped)`, async ({ option, grouped }) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...(grouped ? ["("] : []), option, "3x3+64+1",
            ...(grouped ? [")"] : []), "-depth", "8", "rgb:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(option === "+bilateral-blur" ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(option === "+bilateral-blur"
            ? `magick: option deprecated, unable to execute '+bilateral-blur' at CLI arg ${grouped ? 3 : 2}\n` : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(option === "+bilateral-blur" ? "" : "14202b506275");
    });
}
