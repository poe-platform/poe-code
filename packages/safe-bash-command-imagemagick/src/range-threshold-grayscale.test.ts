import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gray promotion precedes thresholding selected channels.
const cases = [
    { space: "Gray", channel: "R", metadata: "sRGB|srgba 4.0", rgba: "d4595980" },
    { space: "Gray", channel: "A", metadata: "sRGB|srgba 4.0", rgba: "595959ff" },
    { space: "LinearGray", channel: "R", metadata: "sRGB|srgba 4.0", rgba: "e65e5e80" },
    { space: "LinearGray", channel: "A", metadata: "sRGB|srgba 4.0", rgba: "5e5e5eff" },
    { space: "RGB", channel: "R", metadata: "RGB|rgba 4.0", rgba: "005caa80" },
    { space: "RGB", channel: "A", metadata: "RGB|rgba 4.0", rgba: "345caaff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: range-threshold on $space channel $channel matches native output`, async ({ space, channel, metadata, rgba }) => {
        const argv = ["xc:#345caa80", "-colorspace", space, "-channel", channel,
            "-range-threshold", "10,40,60,90%", "+channel", "-format", "%[colorspace]|%[channels]",
            "-write", "info:metadata", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const parsed = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: parsed.args, argumentValues: parsed, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const info = mode === "command" || mode === "retained" ? await fs.readFile("/metadata") : files.get("metadata")!;
        expect(Buffer.from(output).toString("hex")).toBe(rgba);
        expect(new TextDecoder().decode(info)).toBe(metadata);
    });
}
