import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each([
        ["8x7", "8x7+3+4"],
        ["A4", "595x842+3+4"],
        ["8x7+0+0", "8x7+0+0"],
        ["8x7+1", "8x7+1+0"],
    ])(`${mode}: -page %s after -repage preserves only omitted origins`, async (page, expected) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P5\n5 3\n255\n"),
            ...Array.from({ length: 15 }, (_, i) => 17 + 13 * i)]);
        const files = new Map([["/in.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const args = ["/in.pgm", "-repage", "9x8+3+4", "-page", page,
            "-format", "%wx%h:%Wx%H%X%Y", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(data) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(`5x3:${expected}`);
    });
}
