import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: pixel text retains defined alpha,
// including opaque samples and channels disabled by Deactivate or Discrete.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "#80502080", alpha: "Opaque", expected: "srgba(128,80,32,1)" },
        { color: "#80502080", alpha: "Deactivate", expected: "srgba(128,80,32,0.501961)" },
        { color: "#80502080", alpha: "Discrete", expected: "srgba(128,80,32,0.501961)" },
        { color: "#abcdef", alpha: "On", expected: "srgba(171,205,239,1)" },
        { color: "#80502080", alpha: "Off", expected: "srgb(128,80,32)" },
        { color: "#80502080", alpha: "On", expected: "srgba(128,80,32,0.501961)" },
        { color: "#80502080", alpha: "Discrete", extract: true, expected: "8080" },
        { color: "#20508040", alpha: "Deactivate", expected: "srgba(32,80,128,0.25098)" },
        { color: "#20508040", alpha: "Discrete", expected: "srgba(32,80,128,0.25098)" },
        { color: "graya(120,0.5)", alpha: "Opaque", expected: "graya(120,1)" }
    ])(`${mode}: $color -alpha $alpha (extract=$extract)`, async ({ color, alpha, extract, expected }) => {
        const files = new Map([["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = [`xc:${color}`, "-alpha", alpha, ...(extract
            ? ["-alpha", "extract", "-endian", "MSB", "-depth", "16", "gray:/out"]
            : ["-format", "%[pixel:p{0,0}]", "info:/out"])];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(extract ? "hex" : "utf8")).toBe(expected);
    });
}
