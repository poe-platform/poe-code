import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output after converting back to sRGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [space, channels, direct, dithered] of [
        ["HSL", [], "40bfbfff", "40bfbfff"],
        ["Lab", [], "777777ff", "777777ff"],
        ["CMYK", [], undefined, "80ffffff"],
        ["CMYK", ["-channel", "CMYK"], "408080ff", "80ffffff"]
    ] as const) {
        for (const method of ["None", "FloydSteinberg", "Riemersma"] as const) {
            if (method === "None" && direct === undefined) continue;
            it(`${mode}: posterizes ${space} ${channels.join(" ")} with ${method} dithering`, async () => {
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = ["xc:#5080a0", "-colorspace", space, ...channels,
                    ...(method === "None" ? ["+dither"] : ["-dither", method]),
                    "-posterize", "3", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(output).toString("hex")).toBe(method === "None" ? direct : dithered);
            });
        }
    }
}
