import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, one RGBA pixel in big-endian order.
const cases = [
    { args: ["xc:lab(50,0,0)"], hex: "77647760775cffff" },
    { args: ["xc:lab(50%,0,0)"], hex: "ffffffffffffffff" },
    { args: ["xc:cielab(50%,0,0)"], hex: "ffffffffffffffff" },
    { args: ["xc:lab(40% 10% 20%)"], hex: "fffff0fba23fffff" },
    { args: ["xc:lab(40%,10%,20%)"], hex: "fffff0fba23fffff" },
    { args: ["-size", "2x1", "xc:red", "-size", "1x2", "xc:blue", "-colorspace", "sRGB", "-background", "lab(40% 10% 20%)", "-append", "-crop", "1x1+1+1", "+repage"], hex: "fffff0fba23fffff" },
    { args: ["xc:gray50"], hex: "7f7f7f7f7f7fffff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native Lab color literals (${mode}): $args`, async ({ args, hex }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const output: number[] = [];
        let stderr = "";
        const argv = [...args, "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { output.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? output : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
