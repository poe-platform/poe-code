import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +channel exposes the stored extraction result.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operators: ["-channel", "R"], hex: "803456ff" },
        { operators: ["-channel", "G"], hex: "128056ff" },
        { operators: ["-channel", "B"], hex: "123480ff" },
        { operators: ["-channel", "A"], hex: "123456ff" },
        { operators: ["-roll", "+1+0", "-channel", "R"], hex: "803456ff" },
        { operators: ["-roll", "+1+0", "-channel", "A"], hex: "123456ff" },
        { operators: [], hex: "808080ff" },
        { operators: ["-channel", "A", "+channel"], hex: "808080ff" },
        { operators: ["-channel", "RGB"], hex: "808080ff" },
        { operators: ["-channel", "Default"], hex: "808080ff" },
        { operators: ["-channel", "R"], color: "#1234567889ab80ef", depth: 16, hex: "80ef567889abffff" },
        { operators: ["-channel", "A"], color: "#1234567889ab80ef", depth: 16, hex: "1234567889abffff" },
        { operators: ["-colorspace", "Gray", "-channel", "R"], hex: "808080ff" },
        { operators: ["-colorspace", "Gray", "-channel", "G"], hex: "2f2f2fff" },
        { operators: ["-colorspace", "HSL", "-channel", "R"], hex: "125556ff" },
        { operators: ["-colorspace", "HSL", "-channel", "A"], hex: "123456ff" },
        { operators: ["-colorspace", "CMYK", "-channel", "R"], hex: "2b3456ff" },
        { operators: ["-colorspace", "CMYK", "-channel", "K"], hex: "1a4d7fff" },
        { operators: ["-colorspace", "CMYK", "-channel", "A"], hex: "123456ff" },
        { operators: ["-colorspace", "CMYK", "-channel", "RGB"], hex: "2b2b2bff" },
        { operators: ["-colorspace", "CMYK", "-channel", "Default"], hex: "3f3f3fff" },
    ])(`${mode}: extracts selected color channels after $operators ($hex)`, async ({ operators, color = "#12345680", depth = 8, hex }) => {
        const argv = [`xc:${color}`, ...operators, "-alpha", "extract", "+channel", "-depth", String(depth), "-endian", "MSB", "rgba:out"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
