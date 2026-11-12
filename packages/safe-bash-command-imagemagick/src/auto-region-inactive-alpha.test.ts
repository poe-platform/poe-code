import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, full RGBA8 output with the region closed.
const cases = [
    { operation: "-auto-level", alpha: "Discrete", region: true, expected: "4880c0ff007010ff" },
    { operation: "-auto-level", alpha: "Deactivate", region: true, expected: "4880c0ff007010ff" },
    { operation: "-auto-level", alpha: "On", region: true, expected: "4880c08000701040" },
    { operation: "-auto-level", alpha: "Off", region: true, expected: "4080c0ff007010ff" },
    { operation: "-auto-level", alpha: "Discrete", region: false, expected: "ff80c0ff007010ff" },
    { operation: "-auto-gamma", alpha: "Discrete", region: true, expected: "3380c0ff6c7010ff" },
    { operation: "-auto-gamma", alpha: "Deactivate", region: true, expected: "3380c0ff6c7010ff" },
    { operation: "-auto-gamma", alpha: "On", region: true, expected: "3380c0806c701040" },
    { operation: "-auto-gamma", alpha: "Off", region: true, expected: "4080c0ff6c7010ff" },
    { operation: "-auto-gamma", alpha: "Discrete", region: false, expected: "9080c0ff6c7010ff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $operation with $alpha alpha, region=$region`, async ({ operation, alpha, region, expected }) => {
        const argv = ["xc:#4080c080", "xc:#20701040", "+append", "-alpha", alpha,
            ...(region ? ["-region", "1x1+1+0"] : []), "-channel", "R", operation, "+channel", "+region",
            "-depth", "8", `rgba:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
