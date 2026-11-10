import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Reported ImageMagick 7.1.2-35 Q16-HDRI results, including no-extent controls.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { geometry: "6x5", autoOrient: false, expected: "RightTop" },
        { geometry: "6x5", autoOrient: true, expected: "5x6 5,6,+0,+0" },
        { geometry: "4x3", autoOrient: false, expected: "RightTop" },
        { geometry: undefined, autoOrient: false, expected: "RightTop" },
        { geometry: undefined, autoOrient: true, expected: "3x4 3,4,+0,+0" },
        { geometry: "4x3", autoOrient: true, expected: "3x4 3,4,+0,+0" },
        { geometry: "6x5+99+99", autoOrient: false, expected: "RightTop" },
    ])(`preserves orientation through extent $geometry, auto-orient=$autoOrient (${mode})`, async ({ geometry, autoOrient, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const args = ["-size", "4x3", "xc:#4080c080", "-orient", "RightTop",
            ...(geometry ? ["-extent", geometry] : []), ...(autoOrient ? ["-auto-orient"] : []),
            "-format", autoOrient ? "%wx%h %W,%H,%X,%Y" : "%[orientation]", "info:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
