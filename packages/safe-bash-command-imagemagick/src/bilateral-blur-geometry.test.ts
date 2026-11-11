import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGB8 output for this two-pixel PPM.
const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
describe.each(["command", "buffered", "retained", "sync"] as const)("bilateral geometry (%s)", mode => {
    it.each([
        ["3x3+64+1", ""], ["3,3,64,1", ""], ["3/3/64/1", ""],
        ["3x3+64+1x", ""], ["3x3+64+1,", ""], ["3x3+64+1/", ""],
        ["3x3+6.4e+1+1e-0", ""], ["3,3,6.4e+1,1e-0", ""],
        ["bad", "Invalid"], ["3,3,bad,1", "Invalid"],
        ["3/3/64/1e999", "Invalid"],
        ["1001,3,64,1", "Bilateral blur window exceeds limit"], ["3/1001/64/1", "Bilateral blur window exceeds limit"],
    ])("reads %s", async (geometry, expectedError) => {
        const args = ["/in.ppm", "-bilateral-blur", geometry, "-depth", "8", "rgb:-"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const files = new Map([["/in.ppm", input]]);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(expectedError ? 1 : 0);
        if (expectedError) expect(error.toLowerCase()).toContain(expectedError.toLowerCase());
        else expect(error).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expectedError ? "" : "14202b506275");
    });
});
