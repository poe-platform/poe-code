import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for omitted resize axes.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: "x", settings: ["-set", "option:target", "4x3!"], shape: "1x1" },
        { geometry: "1x1!", settings: ["-set", "option:target", "4x3!"], shape: "1x1" },
        { geometry: "x!", settings: [], shape: "5x4" },
        { geometry: "x3", settings: [], shape: "4x3" },
    ])(`adaptive-resize resolves $geometry (${mode})`, async ({ geometry, settings, shape }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n5 4\n255\n"),
            ...Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256),
        ]);
        const files = new Map([["/im.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argumentValues = createCommandArguments([
            "/im.ppm", ...settings, "-adaptive-resize", geometry,
            "-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out",
        ]);
        let stdout = "", stderr = "";
        const result = mode === "public" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(`${shape},${shape}+0+0,DirectClass sRGB `);
    });
}
