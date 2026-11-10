import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: deskew discards disassociated
// alpha, while deactivated alpha retains its samples on the new canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", channels: true, expected: "srgb  3.0" },
        { alpha: "disassociate", channels: false, expected: "000000000000000000" },
        { alpha: "deactivate", channels: false, expected: "ffffffff40ffffffff" }
    ])(`${mode}: deskew after $alpha (channels=$channels)`, async ({ alpha, channels, expected }) => {
        const argv = ["xc:#12345640", "-alpha", alpha, "-filter", "point", "-deskew", "40%",
            ...(channels ? ["-format", "%[channels]"]
                : ["-alpha", "activate", "-channel", "A", "-separate", "+channel", "-depth", "8"]),
            `${channels ? "info" : "gray"}:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(channels ? "utf8" : "hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString(channels ? "utf8" : "hex");
        expect(output).toBe(expected);
    });
}
