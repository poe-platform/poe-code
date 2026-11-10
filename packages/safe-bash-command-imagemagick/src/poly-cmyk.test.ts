import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Captured with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { terms: ".5,1,.5,1", output: ["-format", "%r|%[channels]|%[colorspace]", "info:/out"], expected: "DirectClass CMYK Alpha|cmyka 5.0|CMYK" },
        { terms: "1,1", output: ["-format", "%r|%[channels]|%[colorspace]", "info:/out"], expected: "DirectClass CMYK Alpha|cmyka 5.0|CMYK" },
        { terms: ".5,1,.5,1", output: ["+channel", "-channel", "K", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "47" },
        { terms: ".5,1,.5,1", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "6d516bb7" },
        { terms: ".5,2,.5,2", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "9c9e998e" },
        { terms: ".5,1,.5,1", before: ["-channel", "K"], output: ["+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "b8b8b800" },
        { terms: "1,1", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], expected: "2060b080" },
    ])(`${mode}: retains CMYK for $terms and $output`, async ({ terms, before = [], output, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const args = ["xc:#2060b080", "xc:#c04020ed", "-colorspace", "CMYK", ...before, "-poly", terms, ...output];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
        const bytes = mode === "sync" || mode === "map" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(bytes).toString(output[0] === "-format" ? "utf8" : "hex")).toBe(expected);
    });
}
