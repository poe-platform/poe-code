import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, including conversion back to sRGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "Lab", channel: "R", pixels: "e3fbff80", pixel: "cielaba(100,12.6277,-46.0475,0.501961)" },
        { space: "HSL", channel: "R", pixels: "aa344c80" },
        { space: "DisplayP3", channel: "R", pixels: "7d5aa980" },
        { space: "sRGB", channel: "R", pixels: "585caa80" },
        { space: "Lab", channel: "A", pixels: "345caaff" },
        { space: "HSL", channel: "A", pixels: "345caaff" },
        { space: "DisplayP3", channel: "A", pixels: "345caaff" },
        { space: "sRGB", channel: "A", pixels: "345caaff" },
    ])(`${mode}: range threshold applies to $space channel $channel`, async ({ space, channel, pixels, pixel }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#345caa80", "-colorspace", space, "-channel", channel,
            "-range-threshold", "10,40,60,90%", "+channel",
            ...(pixel ? ["-format", "%[pixel:p{0,0}]", "-write", "info:/pixel"] : []),
            "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
        if (pixel) {
            const info = mode === "command" || mode === "retained" ? await fs.readFile("/pixel") : files.get("/pixel")!;
            expect(new TextDecoder().decode(info)).toBe(pixel);
        }
    });
}
