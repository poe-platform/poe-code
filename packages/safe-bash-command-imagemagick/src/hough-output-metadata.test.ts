import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: the rendered line image has fresh metadata.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { palette: false, background: "black", accumulator: false },
        { palette: true, background: "black", accumulator: false },
        { palette: true, background: "none", accumulator: false },
        { palette: true, background: "black", accumulator: true },
    ])(`${mode}: Hough properties palette=$palette background=$background accumulator=$accumulator`, async ({ palette, background, accumulator }) => {
        const header = new TextEncoder().encode("P6\n9 7\n255\n");
        const input = new Uint8Array(header.length + 9 * 7 * 3);
        input.set(header);
        input.fill(255, header.length + 3 * 9 * 3, header.length + 4 * 9 * 3);
        const files = new Map([["/line.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/line.ppm", input);
        const argv = ["/line.ppm", ...(palette ? ["-type", "Palette"] : []), "-background", background,
            ...(accumulator ? ["-define", "hough-lines:accumulator=true"] : []), "-hough-lines", "3x3+50",
            ...(accumulator ? ["-delete", "1"] : []), "-format", "%m|%r|%z", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("|DirectClass sRGB Alpha|16");
    });
}
