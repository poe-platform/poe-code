import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: separated planes do not retain input alpha metadata.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Deactivate", channel: "R", planes: 1 },
        { alpha: "Deactivate", channel: "All", planes: 3 },
        { alpha: "Discrete", channel: "R", planes: 1 },
        { alpha: "Off", channel: "R", planes: 1 },
        { alpha: "On", channel: "R", planes: 1 },
        { alpha: "Copy", channel: "All", planes: 4 }
    ])(`${mode}: separates $channel after -alpha $alpha into Gray planes without alpha`, async ({ alpha, channel, planes }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = ["xc:#80402860", "-alpha", alpha, "-channel", channel, "-separate", "+channel",
            "-format", "%[colorspace]|%[channels];", "info:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe("Gray|gray  1.0;".repeat(planes));
    });
}
