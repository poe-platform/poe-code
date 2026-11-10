import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray has one intensity channel plus alpha.
const cases = [
    { operation: "Mean", channel: "R", hex: "58585800" },
    { operation: "Median", channel: "R", hex: "66666600" },
    { operation: "Mean", channel: "", hex: "58585864" },
    { operation: "Median", channel: "RGB", hex: "66666600" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`keeps Gray $operation neutral with channel '$channel' (${mode})`, async ({ operation, channel, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["xc:#b5267382", "xc:#297d3846", "-colorspace", "Gray",
            ...(channel ? ["-channel", channel] : []), "-evaluate-sequence", operation,
            "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
