import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, P6 5x4 with RGB bytes 0 through 59.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { options: ["-quantize", "Gray", "-colors", "4"], pixels: "0707070707070725252525252525252525252525" },
        { options: ["-quantize", "Gray", "-colors", "4", "-chop", "1x1+1+1"], pixels: "070707072525252525252525" },
        { options: ["+dither", "-quantize", "Gray", "-colors", "4"], pixels: "101010101010101010102e2e2e2e2e2e2e2e2e2e" },
        { options: ["-colorspace", "Gray", "-colors", "4"], pixels: "10101010101010101010102e2e2e2e2e2e2e2e2e" },
        { options: ["-colors", "4"], pixels: "0707070707070725252525252525252525252525" },
        { options: ["-colorspace", "Gray", "-quantize", "Gray", "-colors", "4"], pixels: "10101010101010101010102e2e2e2e2e2e2e2e2e" },
        { options: ["-treedepth", "8", "-quantize", "Gray", "-colors", "4"], pixels: "10101010101010101010102e2e2e2e2e2e2e2e2e" },
        { options: ["-dither", "FloydSteinberg", "-quantize", "Gray", "-colors", "4"], pixels: "0707070707070707252525252525252525252525" },
    ])(`matches the low-contrast Gray palette (${mode}): $options`, async ({ options, pixels }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n5 4\n255\n"), ...Array.from({ length: 60 }, (_, i) => i)]);
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(pixels);
    });
}
