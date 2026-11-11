import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects +local-contrast before reading its geometry.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    const option = "+local-contrast", geometry = "10x20";
    it.each([
        { before: [], after: [geometry], position: 2 },
        { before: ["-depth", "8"], after: [geometry], position: 4 },
        { before: ["("], after: [geometry, ")"], position: 3 },
        { before: [], after: [], position: 2 },
        { before: ["-depth", "8"], after: [], position: 4 }
    ])(`rejects ${option} at arg $position via ${mode} without writing output`, async ({ before, after, position }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...[255, 0, 0, 0, 255, 0, 0, 0, 255, 64, 160, 32, 144, 32, 160, 16, 18, 32]]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["in.ppm", input], ["out.ppm", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out.ppm", original);
        for (const destination of ["out.ppm", "ppm:-"]) {
            const args = ["in.ppm", ...before, option, ...after, destination];
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
            expect(mode === "buffered" || mode === "sync" ? files.get("out.ppm") : await filesystem.readFile("/out.ppm")).toEqual(original);
        }
    });
}
