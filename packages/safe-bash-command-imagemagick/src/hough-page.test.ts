import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 resets both Hough rasters to page 0x0+0+0.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { page: [], flatten: false, accumulator: false },
        { page: [], flatten: true, accumulator: false },
        { page: ["-repage", "6x5+1+2"], flatten: false, accumulator: false },
        { page: ["-repage", "6x5+1+2"], flatten: true, accumulator: false },
        { page: ["-repage", "6x5-1-2"], flatten: false, accumulator: false },
        { page: ["-repage", "6x5-1-2"], flatten: true, accumulator: false },
        { page: ["-repage", "6x5+1+2"], flatten: false, accumulator: true },
    ])(`resets Hough pages via ${mode}: $page flatten=$flatten accumulator=$accumulator`, async ({ page, flatten, accumulator }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:black", ...page, "-background", "black",
            ...(accumulator ? ["-define", "hough-lines:accumulator=true"] : []), "-hough-lines", "1x1+3",
            ...(flatten ? ["-flatten", "-write", "/out.png"] : []), "-format", "%wx%h|%g;", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(data) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(flatten
            ? "3x2|3x2+0+0;" : `3x2|0x0+0+0;${accumulator ? "180x4|0x0+0+0;" : ""}`);
        if (flatten) {
            const output = decodeImage(mode === "retained" || mode === "command"
                ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([3, 2]);
            expect([...output.data]).toEqual(Array.from({ length: 6 }, () => [0, 0, 0, 255]).flat());
        }
    });
}
