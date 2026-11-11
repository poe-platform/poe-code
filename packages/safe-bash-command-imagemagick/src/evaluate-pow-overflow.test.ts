import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI stores evaluated samples as float32 quanta.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { exponent: "200", info: true, expected: "inf" },
        { exponent: "200", info: false, expected: "ff" },
        { exponent: "20", info: false, expected: "44" },
    ])(`${mode}: Pow $exponent overflow (info=$info)`, async ({ exponent, info, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["xc:white", "-evaluate", "add", "100%", "-evaluate", "Pow", exponent,
            ...(info ? ["-format", "%[fx:r]", "info:"]
                : ["-evaluate", "Pow", "0.005", "-evaluate", "multiply", "0.25", "-depth", "8", "gray:/out.raw"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(info ? expected : "");
        if (!info) {
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        }
    });
}
