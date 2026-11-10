import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw RGBA16 from ImageMagick 7.1.2-35 Q16-HDRI, MAGICK_THREAD_LIMIT=1.
const cases = [
    { statistic: "Mean", region: true, hex: "38682038574c40407b2565bb80808080c4112d3f6993c0c0" },
    { statistic: "Gradient", region: true, hex: "325e2c4c45834040b0b0c0c070708080c4112d3f6993c0c0" },
    { statistic: "", region: true, hex: "80802020c0c040402020e0e050508080d0d030307070c0c0" },
    { statistic: "Mean", region: false, hex: "606060609b4555ab7b2565bb8080808095eb6b1565bbab55" },
    { statistic: "Gradient", region: false, hex: "6060c0c070704040b0b0c0c070708080b0b0b0b020204040" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: $statistic with region=$region matches native pixels`, async ({ statistic, region, hex }) => {
    const fs = new MemoryFileSystem();
    const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append",
        ...(region ? ["-region", "1x1+1+0"] : []), ...(statistic ? ["-statistic", statistic, "3x1"] : []),
        "+region", "-depth", "16", "-endian", "MSB", "rgba:-"];
    const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
