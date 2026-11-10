import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array([
    ...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    128, 128, 128, 32, 128, 128, 128, 224, 128, 128, 128, 32,
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including inactive-alpha controls.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { operations: ["-alpha", "deactivate", "-unique-colors", "-alpha", "activate"], bytes: [128, 128, 128, 32, 128, 128, 128, 224] },
        { operations: ["-alpha", "discrete", "-unique-colors", "-alpha", "activate"], bytes: [128, 128, 128, 32, 128, 128, 128, 224] },
        ...["deactivate", "discrete"].flatMap(alpha => [
            { operations: ["-evaluate", "multiply", "1", "-alpha", alpha, "-unique-colors", "-alpha", "activate"], bytes: [128, 128, 128, 32, 128, 128, 128, 224] },
            { operations: ["-colorspace", "CMYK", "-alpha", alpha, "-unique-colors", "-alpha", "activate", "-colorspace", "sRGB"], bytes: [128, 128, 128, 32, 128, 128, 128, 224] },
        ]),
        { operations: ["-alpha", "off", "-unique-colors"], info: "1x1 srgb  3.0" },
        { operations: ["-unique-colors"], info: "2x1 srgba 4.0" },
        { operations: ["-alpha", "deactivate", "-alpha", "extract"], bytes: [32, 32, 32, 255, 224, 224, 224, 255, 32, 32, 32, 255] },
    ])(`preserves stored alpha in palettes (${mode}): $operations`, async testCase => {
        const { operations } = testCase;
        const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, data] of files) await fs.writeFile(name, data);
        const args = ["/in.pam", ...operations, ...("info" in testCase ? ["-format", "%wx%h %[channels]", "info:/out"] : ["-depth", "8", "rgba:/out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(data) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if ("info" in testCase) expect(new TextDecoder().decode(output)).toBe(testCase.info);
        else expect([...output]).toEqual(testCase.bytes);
    });
}
