import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI accepts forced comma geometry as a no-op.
    it.each([
        { geometry: "4,3!", shape: "5x4" },
        { geometry: "4,3", shape: undefined },
        { geometry: "4x3!", shape: "4x3" },
    ])(`adaptive resize handles $geometry (${mode})`, async ({ geometry, shape }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n5 4\n255\n"),
            ...Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256),
        ]);
        const files = new Map([["/im.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/im.ppm", ...(shape ? ["-set", "option:target", "4x3!"] : []),
            "-adaptive-resize", geometry, "-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(result.exitCode).toBe(shape ? 0 : 1);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const error = "stderr" in result ? result.stderr : stderr;
        if (shape) expect(error).toBe("");
        else expect(error).toContain("invalid argument for option '-adaptive-resize': 4,3");
        expect(new TextDecoder().decode(output)).toBe(shape ? `${shape},${shape}+0+0,DirectClass sRGB ` : "KEEP");
    });
}
