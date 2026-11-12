import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes after reactivating alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", channel: "A", shade: true, expected: "5580aa00" },
        { alpha: "disassociate", channel: "R", shade: true, expected: "b480aa00" },
        { alpha: "disassociate", channel: "A", shade: false, expected: "5580aa60" },
        { alpha: "deactivate", channel: "A", shade: true, expected: "20304060" },
    ])(`${mode}: $alpha alpha, channel $channel, shade=$shade`, async ({ alpha, channel, shade, expected }) => {
        const args = ["xc:#20304060", "-alpha", alpha, "-channel", channel,
            ...(shade ? ["-shade", "0x45"] : []), "+channel", "-alpha", "activate", "-depth", "8",
            mode === "command" ? "rgba:-" : "rgba:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
    });
}
