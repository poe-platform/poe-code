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

// ImageMagick 7.1.2-35 Q16-HDRI reference; also verified with 7.1.2-31.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ["CMYK", "80,110,125", "910b0080"],
        ["CMYK", "100,100,100", "ac006c80"],
        ["HSI", "80,110,125", "4f646080"],
        ["HSI", "100,100,100", "647c6580"],
        ["Lab", "80,110,125", "7e3e5280"],
        ["Lab", "100,100,100", "96519a80"],
        ["Oklch", "80,110,125", "ffb5ff80"],
        ["Oklch", "100,100,100", "a024ff80"],
        ["HSL", "80,110,125", "4f696780"],
        ["HSL", "100,100,100", "65826a80"],
    ])(`relabels %s working samples for modulation %s via ${mode}`, async (space, value, hex) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#34a05c80", "-colorspace", space!, "-modulate", value!,
            "-format", "%[colorspace]", "-write", "info:/space",
            "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const label = mode === "command" || mode === "retained" ? await fs.readFile("/space") : files.get("/space")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
        expect(new TextDecoder().decode(label)).toBe("sRGB");
    });
}
