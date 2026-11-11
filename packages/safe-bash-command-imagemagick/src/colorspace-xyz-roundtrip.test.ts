import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI reference values, before and after palette extraction.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "round trip", input: "#27107530dea8", options: ["-colorspace", "XYZ", "-colorspace", "sRGB"], expected: "271a7530dea7" },
        { name: "palette round trip", input: "#27107530dea8", options: ["-colorspace", "XYZ", "-unique-colors", "-colorspace", "sRGB"], expected: "271a7530dea7" },
        { name: "direct control", input: "#27107530dea8", options: [], expected: "27107530dea8" },
        { name: "red control", input: "red", options: ["-colorspace", "XYZ", "-colorspace", "sRGB"], expected: "ffff00000044" },
        { name: "forward precision", input: "#27107530dea8", options: ["-colorspace", "XYZ", "-precision", "12", "-format", "%[fx:r]|%[fx:g]|%[fx:b]"], expected: "0.203191922136|0.183518393678|0.71430557145", text: true },
    ])(`matches native XYZ $name (${mode})`, async ({ input, options, expected, text }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = [`xc:${input}`, ...options, ...(text ? ["info:/out"] : ["-depth", "16", "-endian", "MSB", "rgb:/out"])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(text ? "utf8" : "hex")).toBe(expected);
    });
}
