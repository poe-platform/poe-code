import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16 montage output, plus the passing convert control.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/out"] as const) {
        it.each([
            { options: [], hex: "ffff00000000" },
            { options: ["-depth", "8"], hex: "ff0000" },
            { options: ["-depth", "16"], hex: "ffff00000000" },
            { options: ["-depth", "8", "+depth"], hex: "ffff00000000" }
        ])(`${mode} ${destination}: montage depth $options`, async ({ options, hex }) => {
            for (const coder of ["rgb", "png"] as const) {
                const args = ["montage", "xc:red", "-tile", "1x1", "-geometry", "+0+0", ...options, `${coder}:${destination}`];
                const fs = new MemoryFileSystem();
                const files = new Map<string, Uint8Array>();
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect(result.exitCode).toBe(0);
                const output = destination === "-"
                    ? mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                    : mode === "command" || mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
                if (coder === "rgb") expect(Buffer.from(output).toString("hex")).toBe(hex);
                else expect(decodeImage(output)).toMatchObject({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) });
            }
        });
    }
}

it("preserves explicit 8-bit convert output", () => {
    const result = runMagickCliSync(["xc:red", "-depth", "8", "rgb:-"], new Map());
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("ff0000");
});
