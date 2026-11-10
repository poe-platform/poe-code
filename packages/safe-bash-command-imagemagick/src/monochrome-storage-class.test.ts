import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: monochrome is indexed Gray, even for one pixel.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default dither metadata", operations: ["-monochrome"], output: ["-format", "%r|%[type]|%[colorspace]|%z", "info:/out"], expected: "PseudoClass Gray |Bilevel|Gray|16", encoding: "utf8" },
        { name: "disabled dither metadata", operations: ["+dither", "-monochrome"], output: ["-format", "%r|%[type]|%[colorspace]|%z", "info:/out"], expected: "PseudoClass Gray |Bilevel|Gray|16", encoding: "utf8" },
        { name: "Bilevel control", operations: ["-type", "Bilevel"], output: ["-format", "%r|%[type]|%[colorspace]|%z", "info:/out"], expected: "PseudoClass Gray |Bilevel|Gray|16", encoding: "utf8" },
        { name: "unchanged monochrome pixels", operations: ["-monochrome"], output: ["-depth", "8", "rgba:/out"], expected: "000000ff", encoding: "hex" }
    ] as const)(`${mode}: $name`, async ({ operations, output, expected, encoding }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["xc:#204080", ...operations, ...output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(encoding)).toBe(expected);
    });
}
