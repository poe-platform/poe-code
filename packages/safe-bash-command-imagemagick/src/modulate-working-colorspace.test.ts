import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: xc:#d8006bec -colorspace SPACE
// -modulate VALUE -depth 8 rgba:-. Modulation relabels the working channels sRGB.
const samples = [
    ["HSL", "100", [234, 255, 108, 236]],
    ["HSL", "80,60,120", [113, 211, 79, 236]],
    ["HSB", "100", [234, 255, 216, 236]],
    ["HSB", "80,60,120", [148, 228, 160, 236]],
] as const;

for (const mode of ["buffered", "sync", "command"] as const) {
    for (const outputMode of ["direct", "convert", "info"]) {
        it.each(samples)(`modulates working %s with %s via ${mode}, output=${outputMode}`, async (space, value, expected) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#d8006bec", "-colorspace", space, "-modulate", value,
                ...(outputMode === "info" ? ["-format", "%[colorspace]", "info:"]
                    : [...(outputMode === "convert" ? ["-colorspace", "sRGB"] : []), "PNG32:/out.png"])];
            const args = createCommandArguments(argv);
            let stdout = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode).toBe(0);
            if (outputMode === "info") {
                expect(("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim()).toBe("sRGB");
                return;
            }
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        });
    }
}
