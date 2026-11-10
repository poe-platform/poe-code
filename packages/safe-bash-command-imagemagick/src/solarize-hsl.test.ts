import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA with explicit little-endian export.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { depth: 8, channel: "G", solarize: true, expected: "75552f60" },
        { depth: 16, channel: "G", solarize: true, expected: "f5743855af2e6060" },
        { depth: 8, channel: "G", solarize: false, expected: "80562360" },
        { depth: 16, channel: "G", solarize: false, expected: "8080565623236060" },
        { depth: 8, channel: "B", solarize: true, expected: "80562360" },
        { depth: 16, channel: "B", solarize: true, expected: "8080565623236060" },
    ])(`${mode}: matches HSL channel $channel solarize=$solarize at depth $depth`, async ({ depth, channel, solarize, expected }) => {
        const argv = ["xc:#80562360", "-colorspace", "HSL", "-channel", channel,
            ...(solarize ? ["-solarize", "40%"] : []), "+channel", "-colorspace", "sRGB",
            "-depth", String(depth), "-endian", "LSB", "rgba:/out"];
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
