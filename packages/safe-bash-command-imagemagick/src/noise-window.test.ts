import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const shorthand of [true, false])
it.each(["%[option:win]", "%[fx:1+2]x1", "3x1"])(`${mode}: NonPeak shorthand=${shorthand} window=%s`, async window => {
    const fs = new MemoryFileSystem();
    const argv = ["xc:red", "xc:green", "xc:blue", "+append", "-define", "win=3x1",
        ...(shorthand ? ["-noise"] : ["-statistic", "NonPeak"]), window, "-depth", "8", "rgb:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "", exitCode: number;
    if (mode === "command") {
        const argumentValues = createCommandArguments(argv);
        ({ exitCode } = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }));
    } else {
        const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        ({ exitCode, stderr } = result);
        stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
    }
    // ImageMagick 7.1.2-35 rejects expressions only for the deprecated shortcut.
    const invalid = shorthand && window !== "3x1";
    expect.soft(exitCode).toBe(invalid ? 1 : 0);
    expect.soft(Buffer.concat(stdout).toString("hex")).toBe(invalid ? "" : "008000ff80ff008000");
    const warning = `magick: option has been replaced '-noise', use "-statistic NonPeak" at CLI arg 7\n`;
    if (invalid) {
        expect(stderr).toContain(warning);
        expect(stderr).toContain(`invalid argument for option '-statistic': ${window}`);
    } else {
        expect(stderr).toBe(shorthand ? warning : "");
    }
});
