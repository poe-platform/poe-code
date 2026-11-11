import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inspect working channels before RGB conversion.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each<{ space: string; dither: string[]; after: string[]; expected: string; coder?: string }>([
        ...[[], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]].flatMap(dither => [
            { space: "HSL", dither, after: [], expected: "HSL|0.5,0.5,0.5" },
            { space: "Lab", dither, after: [], expected: "CIELab|0.5,0.5,0.5" },
            { space: "CMYK", dither, after: [], expected: "CMYK|0.5,0,0" },
            { space: "XYZ", dither, after: [], expected: "XYZ|0,0.5,0.5" },
        ]),
        { space: "HSL", dither: ["+dither"], after: [], expected: "sRGB|0.25,0.75,0.75" },
        { space: "Lab", dither: ["+dither"], after: [], expected: "sRGB|0.466361,0.466322,0.466274" },
        { space: "HSL", dither: [], after: ["-channel", "R", "-separate", "+channel"], expected: "80", coder: "gray" },
        { space: "Lab", dither: [], after: ["-channel", "R", "-separate", "+channel"], expected: "80", coder: "gray" },
        { space: "HSL", dither: [], after: [], expected: "40bec0", coder: "rgb" },
        { space: "HSL", dither: [], after: ["-colorspace", "sRGB"], expected: "40bfbf", coder: "rgb" },
    ])(`${mode}: $space $dither $after $expected`, async ({ space, dither, after, expected, coder }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#4499aa", "-colorspace", space, ...dither, "-posterize", "3", ...after,
            ...(coder ? ["-depth", "8"] : ["-format", "%[colorspace]|%[fx:r],%[fx:g],%[fx:b]"]),
            `${coder ?? "info"}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(coder ? "hex" : "utf8")).toBe(expected);
    });
}
