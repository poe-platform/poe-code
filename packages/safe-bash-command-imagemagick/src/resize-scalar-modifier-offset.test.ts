import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI ignores scalar dimensions with offsets.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale", "-resize", "-thumbnail", "-adaptive-resize"]) {
        it.each([
            ["50%+1+2", "7x5"],
            ["2!+1+2", "7x5"],
            ["2^+1+2", "7x5"],
            ["2@+1+2", undefined],
            ["50%-1-2", "7x5"],
            ["50%+0+0", "7x5"],
            ["50%+1", "7x5"],
            ["50%+", "7x5"],
            ["50+1+2%", "7x5"],
            ["2+1+2@", undefined],
            ["50%+0x1+0x2", "7x5"],
            ["50e-0%+1+2", "7x5"],
            ["50% + 1 + 2", "7x5"],
            ["50x50%+1+2", "4x3"],
            ["2x!+1+2", "2x5"],
            ["2x^+1+2", "3x2"],
            ["2x@+1+2", "2x1"],
            ["50%", "4x3"],
            ["2!", "2x5"],
            ["2^", "3x2"],
            ["2@", "2x1"],
        ] as const)(`${mode} ${operation} %s preserves native dimensions and pixels`, async (geometry, dimensions) => {
            const pixels = Uint8Array.from({ length: 35 }, (_, i) => i + 1);
            const input = Uint8Array.from([...new TextEncoder().encode("P5\n7 5\n255\n"), ...pixels]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.pgm", input], ["/out", keep]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argumentValues = createCommandArguments([
                "/in.pgm", operation, geometry, "-format", "%wx%h", "-write", "info:/shape",
                "-depth", "8", "gray:/out",
            ]);
            let stdout = "", stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
                : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.stdout).toBe("");
            expect(result.exitCode, result.stderr).toBe(dimensions === undefined ? 1 : 0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (dimensions === undefined) {
                expect(result.stderr).toContain("negative or zero image size");
                expect([...output]).toEqual([...keep]);
                if (mode === "command" || mode === "retained") await expect(fs.stat("/shape")).rejects.toMatchObject({ code: "ENOENT" });
                else expect(files.has("/shape")).toBe(false);
            } else {
                expect(result.stderr).toBe("");
                const shape = mode === "command" || mode === "retained" ? await fs.readFile("/shape") : files.get("/shape")!;
                expect(new TextDecoder().decode(shape)).toBe(dimensions);
                const [width, height] = dimensions.split("x").map(Number);
                expect(output.length).toBe(width! * height!);
                if (dimensions === "7x5") expect([...output]).toEqual([...pixels]);
            }
        });
    }
}
