import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference results for neighboring RGB8 pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { palette: true, enhance: true, output: "info", expected: "DirectClass sRGB |srgb  3.0" },
        { palette: true, enhance: false, output: "info", expected: "PseudoClass sRGB |srgb  4.0" },
        { palette: true, enhance: true, output: "rgb", expected: "485c7a4b5f7d" },
        { palette: false, enhance: true, output: "info", expected: "DirectClass sRGB |srgb  3.0" },
    ])(`${mode}: palette=$palette enhance=$enhance output=$output`, async ({ palette, enhance, output, expected }) => {
        const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([70, 90, 120, 77, 97, 127])]);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...(palette ? ["-type", "Palette"] : []), ...(enhance ? ["-enhance"] : []),
            "-format", "%r|%[channels]", "-depth", "8", `${output}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output === "rgb" ? "hex" : "utf8")).toBe(expected);
    });
}
