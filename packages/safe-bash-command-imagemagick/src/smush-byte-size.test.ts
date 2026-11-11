import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [["/in.ppm", new Uint8Array([
    ...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130,
])]] as const;

// ImageMagick 7.1.2-35 reports the first input's byte size, not the new canvas size.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { args: ["/in.ppm", "xc:red", "+smush", "0"], expected: "17|17B" },
        { args: ["/in.ppm", "xc:red", "-smush", "1"], expected: "17|17B" },
        { args: ["/in.ppm", "+smush", "0"], expected: "17|17B" },
        { args: ["/in.ppm", "-smush", "1"], expected: "17|17B" },
        { args: ["xc:red", "/in.ppm", "+smush", "0"], expected: "0|0B" },
        { args: ["xc:red", "/in.ppm", "-smush", "1"], expected: "0|0B" },
        { args: ["/in.ppm"], expected: "17|17B" },
        { args: ["/in.ppm", "xc:red", "+append"], expected: "17|17B" },
    ])(`${mode}: retains first input byte size for $args`, async ({ args, expected }) => {
        const files = new Map(fixtures);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-quiet", ...args, "-format", "%B|%b", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
