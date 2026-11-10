import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Match native ImageMagick palette dimensions without assuming newly initialized meta values.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { size: "4x2", first: "xc:white", sixth: false, extractions: 1, channel: "10", expected: "1x1" },
        { size: "4x2", first: "xc:white", sixth: true, extractions: 1, channel: "11", expected: "1x1" },
        { size: "4x2", first: "xc:white", sixth: false, extractions: 2, channel: "10", expected: "1x1" },
        { size: "4x2", first: "xc:white", sixth: true, extractions: 2, channel: "11", expected: "1x1" },
        { size: "4x2", first: "xc:white", sixth: false, extractions: 1, channel: "R", expected: "1x1" },
        { size: "4x2", first: "xc:white", sixth: false, extractions: 0, channel: "10", expected: "4x2" },
        { size: "4x2", first: "gradient:", sixth: false, extractions: 1, channel: "10", expected: "2x1" },
        { size: "2x4", first: "gradient:", sixth: true, extractions: 2, channel: "11", expected: "4x1" },
    ])(`uses palette dimensions for separated channels (${mode}): $size $first sixth=$sixth extractions=$extractions channel=$channel`, async ({ size, first, sixth, extractions, channel, expected }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["-size", size, first, "xc:white", "xc:white", "xc:white", "gradient:", ...(sixth ? ["xc:white"] : []),
            "-combine", ...Array<string>(extractions).fill("-unique-colors"), "-channel", channel, "-separate", "+channel", "-format", "%wx%h", "info:/out"];
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
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
