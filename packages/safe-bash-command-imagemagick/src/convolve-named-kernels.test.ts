import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 vectors and 2D impulse checks.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each<{ operator: string[]; kernel: string; expected: string; size?: string; point?: string }>([
        ...["Gaussian:1x1", "Blur:1x1", "Laplacian:0"].flatMap(kernel =>
            [["-convolve"], ["-morphology", "Convolve"], ["-morphology", "Correlate"]].map(operator => ({
                operator, kernel, expected: kernel.startsWith("Gaussian") ? "464646737373464646"
                    : kernel.startsWith("Blur") ? "474747717171474747" : "000000ffffff000000",
            }))),
        ...["Gaussian:1x1", "Blur:1x1"].flatMap(kernel =>
            [["-convolve"], ["-morphology", "Convolve"], ["-morphology", "Correlate"]].map(operator => ({
                operator, kernel, size: "3x3", point: "point 1,1", expected: kernel.startsWith("Gaussian")
                    ? "131313202020131313202020343434202020131313202020131313"
                    : "000000000000000000474747717171474747000000000000000000",
            }))),
        { operator: ["-gaussian-blur"], kernel: "1x1", expected: "464646737373464646" },
        { operator: ["-convolve"], kernel: "1,2,1,2,4,2,1,2,1", expected: "404040808080404040" },
        { operator: ["-morphology", "Convolve"], kernel: "3x1:0.25,0.5,0.25", expected: "404040808080404040" },
    ])(`${mode}: applies $operator $kernel`, async ({ operator, kernel, expected, size = "3x1", point = "point 1,0" }) => {
        const argv = ["-size", size, "xc:black", "-fill", "white", "-draw", point,
            "-virtual-pixel", "edge", ...operator, kernel, "-depth", "8", "rgb:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(expected);
    });
}
