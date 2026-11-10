import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI counts the current image list, not each source file.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { images: ["xc:red"], operations: ["-thumbnail", "2x2"], expected: "1|" },
        { images: ["xc:red", "xc:blue"], operations: ["-thumbnail", "2x2"], expected: "2|2|" },
        { images: ["xc:red", "xc:blue"], operations: ["-thumbnail", "2x2", "-thumbnail", "1x1"], expected: "2|2|" },
        { images: ["xc:red", "xc:blue"], operations: ["-thumbnail", "5x3"], expected: "2|2|" },
        { images: ["xc:red", "xc:blue"], operations: ["-delete", "0", "-thumbnail", "2x2"], expected: "1|" },
        { images: ["xc:red", "xc:blue"], operations: ["-thumbnail", "2x2", "-delete", "0", "-thumbnail", "1x1"], expected: "1|" },
        { images: ["xc:red"], operations: ["-duplicate", "2", "-thumbnail", "2x2"], expected: "3|3|3|" },
    ])(`${mode} counts thumbnail pages for $images $operations`, async ({ images, operations, expected }) => {
        const args = ["-size", "5x3", ...images, ...operations, "-format", "%[Thumb::Document::Pages]|", "info:-"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}
