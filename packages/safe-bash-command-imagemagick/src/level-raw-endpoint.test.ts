import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the infinite working sample exports as white.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { coder: "gray", depth: "8", clamp: false, expected: "ff" },
        { coder: "rgb", depth: "8", clamp: false, expected: "ffffff" },
        { coder: "rgb", depth: "16", clamp: false, expected: "ffffffffffff" },
        { coder: "gray", depth: "8", clamp: true, expected: "ff" },
    ])(`${mode}: exports the bright negative-gamma endpoint to $depth-bit $coder (clamp=$clamp)`, async ({ coder, depth, clamp, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["xc:black", "+level", "25%,75%,-1", "-format", "%[fx:r]", "-write", "info:",
            ...(clamp ? ["-clamp"] : []), "-depth", depth, "-endian", "MSB", `${coder}:/out.raw`];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("inf");
        const output = mode === "command" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
