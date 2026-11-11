import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, using the same PPM bytes.
const input = Uint8Array.of(...new TextEncoder().encode("P6\n2 1\n255\n"), 32, 128, 64, 255, 34, 0);
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { space: "Gray", options: [], row: "0,0: (103)  #676767  gray(40.3785%)" },
        { space: "RGB", options: [], row: "0,0: (4,55,13)  #04370D  rgb(1.44438%,21.5861%,5.12695%)" },
        { space: "Gray", options: ["-alpha", "set"], row: "0,0: (103,255)  #676767FF  graya(40.3785%,1)" },
        { space: "Gray", options: ["-depth", "8"], row: "0,0: (103)  #676767  gray(103)" },
        { space: "RGB", options: ["-depth", "8"], row: "0,0: (4,55,13)  #04370D  rgb(4,55,13)" },
        { space: "Gray", options: ["-threshold", "100%"], row: "0,0: (0)  #000000  gray(0)" },
        { space: "RGB", options: ["-threshold", "100%"], row: "0,0: (0,0,0)  #000000  rgb(0,0,0)" },
        { space: "Gray", options: ["-alpha", "set", "-channel", "A", "-evaluate", "multiply", "0.5", "+channel"], row: "0,0: (103,128)  #67676780  graya(40.3785%,0.5)" },
    ])(`preserves $space TXT annotations with $options through ${mode}`, async ({ space, options, row }) => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colorspace", space, ...options, "txt:-"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(("stdout" in result ? result.stdout : stdout).split("\n")[1]).toBe(row);
    });
}

for (const mode of ["buffered", "sync", "retained"] as const) {
    it(`preserves unrounded 16-bit Gray annotations through ${mode}`, async () => {
        const input = Uint8Array.of(...new TextEncoder().encode("P6\n1 1\n65535\n"), 32, 32, 128, 128, 64, 64);
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colorspace", "Gray", "txt:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "# ImageMagick pixel enumeration: 1,1,0,65535,gray\n0,0: (26462)  #675E675E675E  gray(40.3785%)\n" });
    });
}
