import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA after reactivating stored alpha.
const cases = [
    { alpha: "discrete", channel: "A", shade: true, expected: "203040b4" },
    { alpha: "discrete", channel: "A", shade: false, expected: "20304060" },
    { alpha: "discrete", channel: "R", shade: true, expected: "b4304060" },
    { alpha: "on", channel: "A", shade: true, expected: "203040b4" },
    { alpha: "deactivate", channel: "A", shade: true, expected: "20304060" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: alpha $alpha, channel $channel, shade=$shade`, async ({ alpha, channel, shade, expected }) => {
        const argv = ["xc:#20304060", "-alpha", alpha, "-channel", channel,
            ...(shade ? ["-shade", "0x45"] : []), "+channel", "-alpha", "activate", "-depth", "8",
            `rgba:${mode === "command" ? "-" : "/out"}`];
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
