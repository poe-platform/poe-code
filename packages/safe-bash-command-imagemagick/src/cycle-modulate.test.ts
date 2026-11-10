import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
const ppm = Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI: modulate preserves the indexed PNG palette.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "indexed modulate cycle", input: png, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("52ae65ff4867c2ffcfb44cffc23846ff", "hex") },
        { name: "indexed modulate properties", input: png, options: ["-format", "%r;%[channels];%k"], output: "info:/out", expected: Buffer.from("PseudoClass sRGB ;srgb  4.0;4") },
        { name: "indexed modulate pixels", input: png, options: ["-depth", "8"], output: "rgba:/out", expected: Buffer.from("c23846ff52ae65ff4867c2ffcfb44cff", "hex") },
        { name: "direct modulate cycle", input: ppm, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("52ae65ffcfb44cffc23846ff4867c2ff", "hex") },
    ])(`${mode}: $name`, async ({ input, options, output, expected }) => {
        const files = new Map<string, Uint8Array>([["/in", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in", "-modulate", "100,60", ...options, output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect([...actual]).toEqual([...expected]);
    });
}
