import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: half-pixel results depend on image-ratio arithmetic.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-resize", "-scale", "-thumbnail", "-adaptive-resize"]) {
        it.each([
            { width: 7, height: 5, square: false, geometry: "1:2", expected: "2x5" },
            { width: 7, height: 5, square: false, geometry: "2:3", expected: "3x5" },
            { width: 7, height: 5, square: true, geometry: "1:2", expected: "4x7" },
            { width: 5, height: 7, square: false, geometry: "2:1", expected: "5x2" },
            { width: 5, height: 7, square: true, geometry: "2:1", expected: "7x4" },
        ])(`${mode} ${operation} $geometry on $width x $height (square=$square) rounds to $expected`, async ({ width, height, square, geometry, expected }) => {
            const input = new Uint8Array([
                ...new TextEncoder().encode(`P5\n${width} ${height}\n255\n`),
                ...Array.from({ length: width * height }, (_, i) => i + 1),
            ]);
            const files = new Map([["/in.pgm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", input);
            const argv = ["/in.pgm", ...(square ? ["-sample", "7x7!"] : []), operation, geometry, "-format", "%wx%h", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
