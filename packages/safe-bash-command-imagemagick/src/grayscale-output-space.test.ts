import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: grayscale metadata and subsequent sRGB RGBA8 output.
const cases = [
    { method: "Average", gray: 46 },
    { method: "Mean", gray: 46 },
    { method: "Rec601Luma", gray: 89 },
    { method: "Rec709Luma", gray: 89 },
    { method: "RMS", gray: 61 },
    { method: "Brightness", gray: 103 },
    { method: "MS", gray: 255 },
    { method: "Lightness", gray: 56 },
    { method: "Rec601Luminance", gray: 97, linear: true },
    { method: "Rec709Luminance", gray: 94, linear: true },
    { method: "Average", gray: 105, srgb: true }
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${execution}: labels $method grayscale and converts its samples to sRGB ($gray)`, async ({ method, gray, linear, srgb }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#345caa80", ...(srgb ? [] : ["-colorspace", "RGB"]), "-grayscale", method,
            "-format", "%[colorspace]:%[channels]:%[gamma]", "-write", "info:",
            "-colorspace", "sRGB", "-depth", "8", "rgba:out.rgba"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = execution === "sync" ? runMagickCliSync(argv, files)
            : execution === "buffered" ? await runMagickCli(argv, files)
            : execution === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(linear ? "LinearGray:lineargraya 2.0:1" : "Gray:graya 2.0:0.454545");
        const output = execution === "command" || execution === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
        expect([...output]).toEqual([gray, gray, gray, 128]);
    });
}
