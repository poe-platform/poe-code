import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with input and palette in the same colorspace.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    for (const [space, red, rgba] of [
        ["DisplayP3", "b0", "be429aff"], ["Adobe98", "a6", "be429aff"],
        ["ProPhoto", "9b", "be429aff"], ["Gray", "63", "636363ff"],
    ]) {
        for (const output of ["space", "red", "rgba"]) it.each(["none", "FloydSteinberg", "Riemersma"])(`${mode}: replaces ${space} samples for ${output} using %s dithering`, async dither => {
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["(", "xc:#be429a", "-colorspace", space!, "-write", "mpr:p", "+delete", ")",
                "xc:#34a05c", "-colorspace", space!, "-dither", dither, "-remap", "mpr:p",
                ...(output === "space" ? ["-format", "%[colorspace]", "info:/out"]
                    : output === "red" ? ["-channel", "R", "-separate", "-depth", "8", "gray:/out"]
                    : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString(output === "space" ? "utf8" : "hex"))
                .toBe(output === "space" ? space : output === "red" ? red : rgba);
        });
    }
}
