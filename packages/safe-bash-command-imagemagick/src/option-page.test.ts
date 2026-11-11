import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI applies option:page to current images and later inputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "unset chop", args: ["/in.ppm"], expected: "3x2 3x2+0+0" },
        { name: "direct page chop", args: ["/in.ppm", "-page", "8x7+3+2"], expected: "3x2 6x5+2+1" },
        { name: "image page chop", args: ["/in.ppm", "-set", "page", "8x7+3+2"], expected: "3x2 6x5+2+1" },
        { name: "option page chop", args: ["/in.ppm", "-set", "option:page", "8x7+3+2"], expected: "3x2 6x5+2+1" },
        { name: "option page before input", args: ["-set", "option:page", "8x7+3+2", "/in.ppm"], expected: "3x2 6x5+2+1" },
        { name: "expanded option page", args: ["/in.ppm", "-set", "option:page", "%[fx:w*2]x%[fx:h+4]+3+2"], expected: "3x2 6x5+2+1" },
        { name: "GIF frames", args: ["xc:red", "xc:blue", "-set", "option:page", "4x3+1+1"], expected: "", gif: true },
        { name: "GIF later input", args: ["xc:red", "-set", "option:page", "4x3+1+1", "xc:blue"], expected: "", gif: true },
    ])(`${mode}: $name`, async ({ args, expected, gif }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i)]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = [...args, ...(gif ? ["/out.gif"] : ["-chop", "1x1+1+1", "-format", "%wx%h %g", "info:"])];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
        if (gif) {
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
            for (const page of [0, 1]) {
                const image = decodeImage(output, { page, coalesce: false });
                expect(image).toMatchObject({ width: 1, height: 1, virtualCanvas: { width: 4, height: 3, x: 1, y: 1 } });
                expect([...image.data]).toEqual(page === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
            }
        }
    });
}
