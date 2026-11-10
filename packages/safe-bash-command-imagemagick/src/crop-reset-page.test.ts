import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 restores each zero canvas dimension from the source raster.
for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    for (const output of ["info", "flatten"] as const) {
        it.each([
            { page: ["+repage"], width: 5, height: 3 },
            { page: [], width: 5, height: 3 },
            { page: ["-repage", "0x3+0+0"], width: 5, height: 3 },
            { page: ["-repage", "5x0+0+0"], width: 5, height: 3 },
            { page: ["-repage", "3x2+0+0"], width: 3, height: 2 },
        ])(`preserves the crop canvas after $page (${mode}, ${output})`, async ({ page, width, height }) => {
            const keep = new TextEncoder().encode("KEEP");
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const files = new Map([["/out", keep]]);
            const args = ["-size", "5x3", "xc:blue", ...page, "-crop", "1x1+1+1", ...(output === "info"
                ? ["-format", "%wx%h %W,%H,%X,%Y", "info:/out"]
                : ["-background", "white", "-flatten", "-depth", "8", "rgba:/out"])];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (output === "info") {
                expect(new TextDecoder().decode(bytes)).toBe(`1x1 ${width},${height},+1,+1`);
            } else {
                const expected = new Uint8Array(width * height * 4).fill(255);
                expected.set([0, 0, 255, 255], (width + 1) * 4);
                expect(bytes).toEqual(expected);
            }
        });
    }
}
