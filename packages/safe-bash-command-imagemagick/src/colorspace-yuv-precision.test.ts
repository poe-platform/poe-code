import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: retain float quantum precision before and after editing Y.
const cases = [
    { name: "unmodified chroma", operations: ["-precision", "16", "-format", "%[fx:p{1,0}.g],%[fx:p{1,0}.b]", "info:"], expected: "0.5015607714389256,0.7503921449416342" },
    { name: "luminance auto-gamma", operations: ["-channel", "R", "-auto-gamma", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], expected: "5a9799d6cb076060bb504ce27307bdbd" },
    { name: "unmodified round trip", operations: ["-channel", "R", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], expected: "20275f6690976060807f12113837bdbd" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: preserves native YUV precision for $name`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["xc:#205f9060", "xc:#801238bd", "+append", "-colorspace", "YUV", ...operations];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        if (operations.at(-1) === "info:") {
            const samples = result.stdout.split(",").map(Number);
            const reference = expected.split(",").map(Number);
            expect(samples).toHaveLength(reference.length);
            for (const [index, sample] of samples.entries()) expect(sample).toBeCloseTo(reference[index]!, 15);
        } else {
            expect(result.stdout).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
