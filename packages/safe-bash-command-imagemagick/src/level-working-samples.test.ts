import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, INFO samples and raw RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "numeric above range", options: ["xc:white", "-evaluate", "multiply", "1.2", "+level", "20%,80%,1"], sample: "0.92" },
        { name: "numeric below range", options: ["xc:black", "-evaluate", "subtract", "10%", "+level", "20%,80%,1"], sample: "0.139999" },
        { name: "color above range", options: ["xc:white", "-evaluate", "multiply", "1.2", "+level-colors", "#333,#ccc"], sample: "0.92" },
        { name: "color below range", options: ["xc:black", "-evaluate", "subtract", "10%", "+level-colors", "#333,#ccc"], sample: "0.139999" },
        { name: "numeric explicit clamp", options: ["xc:white", "-evaluate", "multiply", "1.2", "-clamp", "+level", "20%,80%,1"], sample: "0.8" },
        { name: "color explicit clamp", options: ["xc:black", "-evaluate", "subtract", "10%", "-clamp", "+level-colors", "#333,#ccc"], sample: "0.2" },
        { name: "inverse modifier", options: ["xc:white", "-evaluate", "multiply", "1.2", "-level", "20%,80%!"], sample: "0.92" },
        { name: "gamma above range", options: ["xc:white", "-evaluate", "multiply", "1.2", "+level", "20%,80%,2"], sample: "1.064" },
        { name: "gamma below range", options: ["xc:black", "-evaluate", "subtract", "10%", "+level", "20%,80%,2"], sample: "0.139999" },
        { name: "masked above-range alpha", options: ["xc:rgba(255,255,255,1)", "-evaluate", "multiply", "1.2", "-write-mask", "xc:gray50", "+level", "20%,80%,1"], sample: "1.05773" },
        { name: "masked negative alpha", options: ["xc:rgba(0,0,0,0)", "-evaluate", "subtract", "10%", "-write-mask", "xc:gray50", "+level", "20%,80%,2"], sample: "0.0255564" },
        { name: "YUV control", options: ["xc:#f0045f", "-colorspace", "YUV"], rgb: "f0045f" },
        { name: "YUV numeric identity", options: ["xc:#f0045f", "-colorspace", "YUV", "+level", "0%,100%"], rgb: "f0045f" },
        { name: "YUV color identity", options: ["xc:#f0045f", "-colorspace", "YUV", "+level-colors", "black,white"], rgb: "f0045f" },
    ])(`preserves working samples for $name via ${mode}`, async ({ options, sample, rgb }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...options, ...(rgb ? ["-colorspace", "sRGB", "-depth", "8", "rgb:/out.raw"] : ["-format", "%[fx:b]", "info:"])];
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(sample ?? "");
        if (rgb) {
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
            expect(Buffer.from(output).toString("hex")).toBe(rgb);
        }
    });
}
