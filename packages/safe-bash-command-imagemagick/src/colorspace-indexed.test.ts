import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
const ppm = Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs for indexed colorspace conversion.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "indexed Gray properties", input: png, space: "Gray", options: ["-format", "%r;%[channels];%k"], output: "info:/out", expected: Buffer.from("DirectClass Gray ;gray  1.0;4") },
        { name: "indexed CMYK properties", input: png, space: "CMYK", options: ["-format", "%r;%[channels];%k"], output: "info:/out", expected: Buffer.from("DirectClass CMYK ;cmyk  4.0;4") },
        { name: "indexed Gray cycle", input: png, space: "Gray", options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("535353ffcacacaffa3a3a3ff3d3d3dff", "hex") },
        { name: "direct Gray cycle", input: ppm, space: "Gray", options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("535353ffcacacaffa3a3a3ff3d3d3dff", "hex") },
        { name: "direct CMYK properties", input: ppm, space: "CMYK", options: ["-format", "%r;%[channels];%k"], output: "info:/out", expected: Buffer.from("DirectClass CMYK ;cmyk  4.0;4") },
    ])(`${mode}: $name`, async ({ input, space, options, output, expected }) => {
        const files = new Map<string, Uint8Array>([["/in", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in", "-colorspace", space, ...options, output];
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
