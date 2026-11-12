import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // Native ImageMagick 7.1.2 Q16-HDRI results, including identity splice.
    it.each([
        { background: "red", splice: "1x0+1+0", expected: "PaletteAlpha DirectClass sRGB Alpha" },
        { background: "#808080", splice: "1x0+1+0", expected: "GrayscaleAlpha DirectClass Gray Alpha" },
        { background: "red", splice: "0x0", expected: "GrayscaleAlpha DirectClass sRGB Alpha" },
        { background: "#808080", splice: "0x0", expected: "GrayscaleAlpha DirectClass Gray Alpha" },
        { background: "red", expected: "Grayscale DirectClass Gray Alpha" },
        { background: "red", splice: "1x0+1+0", pixels: true, expected: "2f2f2f80ff0000ff" },
        { background: "#808080", splice: "1x0+1+0", pixels: true, expected: "2f2f2f80808080ff" },
    ])(`recomputes splice image type with active alpha (${mode}): %j`, async ({ background, splice, pixels, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["xc:#12345680", "-colorspace", "Gray", "-background", background,
            ...(splice ? ["-splice", splice] : []),
            ...(pixels ? ["-depth", "8", "rgba:out"] : ["-format", "%[type] %r", "info:out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(pixels ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes)).toBe(expected);
    });
}
