import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: "%[fx:w-1]x%h!", target: "4x3!", shape: "4x4" },
        { geometry: "%[option:target]", target: "4x3!", shape: "4x3" },
        { geometry: "4x4!", target: "4x3!", shape: "4x4" },
        { geometry: "4x3!", target: "4x3!", shape: "4x3" },
        { geometry: "%[option:target]", target: "50%", shape: "3x2" },
        { geometry: "%[option:target]", target: "invalid", shape: undefined },
    ])(`adaptive-resize expands $geometry with target=$target (${mode})`, async ({ geometry, target, shape }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n5 4\n255\n"),
            ...Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256),
        ]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/im.ppm", input], ["/out", keep], ["/pixels", keep]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argumentValues = createCommandArguments([
            "/im.ppm", "-set", "option:target", target, "-adaptive-resize", geometry,
            "-set", "option:target", "invalid", "-depth", "8", "-write", "rgb:/pixels",
            "-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out",
        ]);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        if (!shape) {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("invalid argument for option '-adaptive-resize': invalid");
            expect(output).toEqual(keep);
            expect(pixels).toEqual(keep);
            return;
        }
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        // Native ImageMagick 7.1.2-35 Q16-HDRI.
        expect(new TextDecoder().decode(output)).toBe(`${shape},${shape}+0+0,DirectClass sRGB `);
        const controls = new Map([["/im.ppm", input]]);
        expect(runMagickCliSync([
            "/im.ppm", "-adaptive-resize", geometry === "%[option:target]" ? target : `${shape}!`,
            "-depth", "8", "rgb:/pixels",
        ], controls).exitCode).toBe(0);
        expect(pixels).toEqual(controls.get("/pixels"));
    });

    it(`adaptive-resize expands FX against each current image (${mode})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments([
            "-size", "5x4", "xc:red", "-size", "6x5", "xc:blue",
            "-adaptive-resize", "%[fx:w-1]x%h!", "-format", "%wx%h;", "info:",
        ]);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe("4x4;5x5;");
    });
}
