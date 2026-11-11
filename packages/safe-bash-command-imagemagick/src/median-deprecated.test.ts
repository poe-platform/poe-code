import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference output.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Uint8Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256)]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { option: "+median", grouped: false },
        { option: "+median", grouped: true },
        { option: "-median", grouped: false }
    ])(`${mode}: matches native $option status and output (grouped=$grouped)`, async ({ option, grouped }) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["-quiet", "/in.ppm", ...(grouped ? ["("] : []), option, "3",
            ...(grouped ? [")"] : []), "-depth", "8", "rgba:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(option === "+median" ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(option === "+median"
            ? `magick: option deprecated, unable to execute '+median' at CLI arg ${grouped ? 4 : 3}\n` : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(option === "+median" ? "" : "355ca5ff5a59a2ffc9377dffa45958ffa4c836ff5aa3a5ff5a7ea2ff7c7b80ff7f597dff7f5658ff7cc533ff5aa3a2ff577ec4ff3259a2ff32569fff");
    });
}
