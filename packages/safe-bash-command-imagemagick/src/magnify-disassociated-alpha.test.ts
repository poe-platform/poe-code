import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit channel output.
const cases = [
    { alpha: "Disassociate", factor: 2, channel: "A", expected: "00000000" },
    { alpha: "Disassociate", factor: 3, channel: "A", expected: "000000000000000000" },
    { alpha: "Disassociate", factor: 1, channel: "A", expected: "60" },
    { alpha: "Discrete", factor: 2, channel: "A", expected: "60606060" },
    { alpha: "Discrete", factor: 3, channel: "A", expected: "606060606060606060" },
    { alpha: "On", factor: 2, channel: "A", expected: "60606060" },
    { alpha: "Disassociate", factor: 2, channel: "R", expected: "ffffffff" },
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: magnify $factor x with $alpha alpha, channel $channel`, async ({ alpha, factor, channel, expected }) => {
        const argv = ["xc:#80402060", "-alpha", alpha,
            ...(factor === 3 ? ["-define", "magnify:method=scale3x"] : []),
            ...(factor > 1 ? ["-magnify"] : []), "-channel", channel, "-separate", "+channel",
            "-depth", "8", `gray:${execution === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = execution === "command" ? stdout
            : Buffer.from(execution === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
