import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each([
        ["set", true, true, "45586673818f484f6f82905d677482"],
        ["copy", true, true, "45586673818f484f6f82905d677482"],
        ["off", true, true, "45586673818f484f6f82905d677482"],
        ["copy", true, false, "0e33587da1c634587da2c734597ea2"],
        ["off", false, true, "3732a54852a259619b6a7594748c9250b4945839906949897a6a8283827f7a9f98843496954c93a66b8cb77789"],
    ])(`keeps 5×3 wavelet pixels deterministic (alpha=%s, gray=%s, denoise=%s, ${mode})`, async (alpha, gray, denoise, expected) => {
        const input = Buffer.concat([
            Buffer.from("P6\n5 3\n255\n"),
            Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())
        ]);
        const files = new Map([["/in.ppm", input]]), fs = createMemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-alpha", alpha, ...(gray ? ["-colorspace", "Gray"] : []),
            ...(denoise ? ["-wavelet-denoise", "20%"] : []), ...(gray ? ["-channel", "R", "-separate"] : []),
            "-depth", "8", `${gray ? "gray" : "rgb"}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        // ImageMagick 7.1.2-35 Q16-HDRI, one thread, full gray/RGB planes.
        // For GrayAlpha, round-trip the input through float32 graya before denoising:
        // native otherwise reads stale conversion pixels from its unused scratch plane.
        // The round-trip preserves every input sample; Safe Bash starts scratch at zero.
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
