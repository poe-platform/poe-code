import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete big-endian RGBA stdout.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["3fff40004001ffff", "25%", "3fff4000bffeffff"],
        ["7fff80008001ffff", "50%", "7fff80007ffeffff"],
        ["bfffc000c001ffff", "75%", "bfffc0003ffeffff"],
        ["3fff40004001ffff", "16384", "3fff4000bffeffff"],
        ["7fff80008001ffff", "32768", "7fff80007ffeffff"],
        ["bfffc000c001ffff", "49152", "bfffc0003ffeffff"],
        ["7fff80008001ffff", "32767.5", "7fff7fff7ffeffff"],
    ])(`${mode}: solarizes xc:#%s at %s`, async (color, threshold, expected) => {
        const argv = [`xc:#${color}`, "-channel", "RGB", "-solarize", threshold!, "+channel",
            "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
