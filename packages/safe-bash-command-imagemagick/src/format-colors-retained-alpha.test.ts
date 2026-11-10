import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI counts retained alpha even without blending.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operations of [[], ["-evaluate", "multiply", "1"], ["-colorspace", "CMYK"]]) {
        for (const unique of [false, true]) {
            it.each([
                { alpha: "Discrete", colors: 2 },
                { alpha: "Deactivate", colors: 2 },
                { alpha: "On", colors: 2 },
                { alpha: "Off", colors: 1 },
            ])(`${mode}: counts $alpha colors (${operations.join(" ")}, unique=${unique})`, async ({ alpha, colors }) => {
                const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/out", files.get("/out")!);
                const argv = ["xc:#80402060", "xc:#804020ff", "xc:#80402060", "+append", ...operations,
                    "-alpha", alpha, ...(unique ? ["-unique-colors"] : []), "-format", "%k|%[colors]|%w", "info:/out"];
                const argumentValues = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(new TextDecoder().decode(output)).toBe(`${colors}|${colors}|${unique ? colors : 3}`);
            });
        }
    }
}
