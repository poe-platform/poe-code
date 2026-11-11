import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects +wavelet-denoise before reading its threshold.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    const option = "+wavelet-denoise", threshold = "25%";
    it.each([
        { before: [], after: [threshold], position: 2 },
        { before: ["-repage", "13x9+2+3"], after: [threshold], position: 4 },
        { before: ["("], after: [threshold, ")"], position: 3 },
        { before: [], after: [], position: 2 }
    ])(`rejects ${option} at arg $position via ${mode} without writing output`, async ({ before, after, position }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"), ...Uint8Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256)]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["in.ppm", input], ["out", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out", original);
        for (const destination of ["rgb:out", "rgb:-"]) {
            const args = ["in.ppm", ...before, option, ...after, "-endian", "MSB", "-depth", "16", destination];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `magick: option deprecated, unable to execute '${option}' at CLI arg ${position}\n` });
            expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out")).toEqual(original);
        }
    });
}
