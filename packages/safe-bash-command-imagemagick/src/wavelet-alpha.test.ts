import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["sRGB", "HSL", "CMYK"])(`matches native wavelet alpha retention in %s (${mode})`, async space => {
        for (const alpha of ["disassociate", "deactivate", "associate", "discrete", "on"]) {
            for (const threshold of [undefined, "0", "20%"] as const) {
                const fs = new MemoryFileSystem();
                const args = ["-size", "5x3", "xc:#20406080", "-colorspace", space, "-alpha", alpha,
                    ...(threshold === undefined ? [] : ["-wavelet-denoise", threshold]),
                    "-alpha", "activate", "-format", "%[fx:a]", "info:"];
                let stdout = "", stderr = "";
                const result = mode === "command" ? { ...await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, new Map())
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                // Native drops disassociated opacity even at zero threshold.
                expect(result.stdout, `${alpha}, ${threshold}`).toBe(alpha === "disassociate" && threshold !== undefined ? "0" : "0.501961");
            }
        }
    });
}
