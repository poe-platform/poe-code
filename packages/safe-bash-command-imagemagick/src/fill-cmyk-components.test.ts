import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw big-endian 16-bit RGBA.
const cases = [
    { name: "CMYK fill tint", args: ["xc:#4278a280", "-fill", "cmyk(11%,22%,33%,44%)", "-tint", "30"], expected: "208f552089978080" },
    { name: "CMYK fill colorize", args: ["xc:#4278a280", "-fill", "cmyk(11%,22%,33%,44%)", "-colorize", "100"], expected: "1c293852547b8080" },
    { name: "standalone CMYK color", args: ["xc:cmyk(11%,22%,33%,44%)"], expected: "7f976fd2600dffff" },
    { name: "RGB fill tint", args: ["xc:#4278a280", "-fill", "#d65541", "-tint", "30"], expected: "1e3722f14d838080" },
    { name: "RGB fill colorize", args: ["xc:#4278a280", "-fill", "#d65541", "-colorize", "100"], expected: "d6d6555541418080" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ args, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...args, "-depth", "16", "-endian", "MSB", `rgba:${mode === "command" ? "-" : "/out"}`];
        const commandArgs = createCommandArguments(argv);
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? stdout : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
