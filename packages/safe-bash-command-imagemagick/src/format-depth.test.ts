import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reports the explicit image depth.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([undefined, 5, 8, 12, 16])(`${mode}: formats xc image depth %s`, async depth => {
        const fs = new MemoryFileSystem();
        const previous = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", previous]]);
        await fs.writeFile("/out", previous);
        const argv = ["xc:#2060b080", ...(depth === undefined ? [] : ["-depth", String(depth)]), "-format", "%z", "info:/out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(String(depth ?? 8));
    });
}
