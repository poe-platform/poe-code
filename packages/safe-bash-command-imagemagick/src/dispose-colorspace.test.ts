import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Dispose places working samples on the page canvas.
const cases = [
    { colorspace: "HSL", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], pixel: "33669980", background: "ffffff00" },
    { colorspace: "CMYK", output: ["-alpha", "off", "-channel", "K", "-separate", "+channel", "-depth", "8", "gray:-"], pixel: "66", background: "00" },
    { colorspace: "Gray", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], pixel: "5f5f5f80", background: "ffffff00" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const { page, pixels } of [
        { page: "3x1+1+0", pixels: [0, 1, 1] },
        { page: "3x2+1+1", pixels: [0, 0, 0, 0, 1, 1] },
        { page: "3x1-1+0", pixels: [1, 0, 0] },
        { page: "3x1+2+0", pixels: [0, 0, 1] }
    ]) it.each(cases)(`${mode}: aligns $colorspace samples with Dispose page ${page}`, async ({ colorspace, output, pixel, background }) => {
        const argv = ["(", "-size", "2x1", "xc:#33669980", "-colorspace", colorspace, "-repage", page, ")", "-layers", "Dispose", ...output];
        const files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            fs: new MemoryFileSystem(), signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(pixels.map(present => present ? pixel : background).join(""));
    });
}
