import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it(`promotes indexed storage only after wavelet denoising (${mode})`, async () => {
        const input = Buffer.concat([
            Buffer.from("P6\n5 3\n255\n"),
            Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())
        ]);
        const files = new Map([["/in.ppm", input]]), fs = createMemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colors", "16", "-print", "%r|", "-wavelet-denoise", "20%", "-format", "%r", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        // Native ImageMagick 7.1.2-35 Q16-HDRI.
        expect(stdout).toBe("PseudoClass sRGB |DirectClass sRGB ");
    });
}
