import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, including the literal-gap controls.
for (const mode of ["public", "sync", "buffered", "retained"] as const) {
    it.each([
        { operation: "-smush", gap: "+%n", size: "3x7" },
        { operation: "+smush", gap: "%[fx:n]", size: "7x3" },
        { operation: "-smush", gap: "%[fx:u[1].w]", size: "3x8" },
        { operation: "-smush", gap: "%[fx:u[1].h]", size: "3x7" },
        { operation: "-smush", gap: "%[fx:w]", size: "3x7" },
        { operation: "-smush", gap: "2", size: "3x7" },
        { operation: "-smush", gap: "3", size: "3x8" },
        { operation: "-smush", gap: "%[fx:u[2].w]", size: undefined },
    ])(`${mode} expands $operation $gap against all input frames`, async ({ operation, gap, size }) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argumentValues = createCommandArguments([
            "-size", "2x3", "xc:#8040c080", "-size", "3x2", "xc:#30905040",
            operation, gap, "-format", "%wx%h %g %[colorspace] %[channels];", "info:/out"
        ]);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
            : await runConvertCli(argumentValues.args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(size === undefined ? 1 : 0);
        const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(size === undefined ? "KEEP" : `${size} ${size}+0+0 sRGB srgba 4.0;`);
        if (size === undefined) expect(error).toContain("ImgNum 2 bad for ImgListLen 2");
        else expect(error).toBe("");
    });
}
