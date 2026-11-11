import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gray has one color plane, selected by R.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Gray", "R", "2f2f2f80"],
        ["Gray", "G", "3f3f3f80"],
        ["Gray", "B", "3f3f3f80"],
        ["Gray", "RGB", "2f2f2f80"],
        ["Gray", "A", "3f3f3f70"],
        ["Gray", "Default", "2f2f2f70"],
        ["Gray", "", "2f2f2f70"],
        ["LinearGray", "R", "0f0f0f80"],
        ["LinearGray", "G", "40404080"],
        ["LinearGray", "B", "40404080"],
    ])(`${mode}: despeckle preserves %s neutrality with channel %s`, async (space, channel, expected) => {
        const args = ["xc:#32406080", "-colorspace", space,
            ...(channel ? ["-channel", channel] : []), "-despeckle", "+channel",
            "-format", "%[colorspace] %[channels]", "-write", "info:/space",
            "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/space") : files.get("/space")!;
        expect(new TextDecoder().decode(metadata)).toBe(`${space} ${space === "Gray" ? "graya" : "lineargraya"} 2.0`);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
