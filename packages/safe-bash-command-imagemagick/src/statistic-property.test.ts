import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { method: "%[method]", geometry: "3x1", methodValue: "Maximum", window: "3x1" },
        { method: "Maximum", geometry: "%[window]", methodValue: "Maximum", window: "3x1" },
        { method: "Maximum", geometry: "%[fx:3]x1", methodValue: "Maximum", window: "3x1" },
        { method: "%[method]", geometry: "%[window]", methodValue: "mAxImUm", window: "3x1" },
        { method: "Maximum", geometry: "3x1", methodValue: "Maximum", window: "3x1" },
        { method: "%[method]", geometry: "3x1", methodValue: "unknown", window: "3x1" },
        { method: "Maximum", geometry: "%[window]", methodValue: "Maximum", window: "bad" },
    ])(`${mode}: expands statistic $method ($methodValue) and $geometry ($window)`, async ({ method, geometry, methodValue, window }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n5 1\n255\n"),
            3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
        ]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/byte.ppm", input);
        await fs.writeFile("/out.png", keep);
        const argumentValues = createCommandArguments([
            "-set", "option:method", methodValue, "-set", "option:window", window,
            "/byte.ppm", "-statistic", method, geometry,
            "-set", "option:method", "unknown", "-set", "option:window", "bad", "PNG64:/out.png",
        ]);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect(stdout).toBe("");
        if (methodValue === "unknown" || window === "bad") {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain(methodValue === "unknown" ? "unrecognized statistic type '-statistic' 'unknown'" : "invalid argument for option '-statistic': bad");
            expect(output).toEqual(keep);
        } else {
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([5, 1]);
            // Exact RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
            expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(
                "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff",
            );
        }
    });
}
