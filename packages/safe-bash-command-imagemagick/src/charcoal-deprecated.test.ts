import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +charcoal is deprecated; -charcoal outputs c0258a.
const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("13385d82a7ccf1163b", "hex")]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["+charcoal", "-charcoal"])(`${mode}: matches native %s status and output`, async option => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", option, "1x1", "-depth", "8", "gray:-"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(option === "+charcoal" ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(option === "+charcoal"
            ? "magick: option deprecated, unable to execute '+charcoal' at CLI arg 2\n" : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(option === "+charcoal" ? "" : "c0258a");
    });
}
