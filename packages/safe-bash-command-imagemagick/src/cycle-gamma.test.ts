import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
const ppm = Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI: gamma makes the indexed PNG DirectClass.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "indexed gamma cycle", input: png, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("fde55aff5a91f4fff7325cff73e491ff", "hex") },
        { name: "indexed gamma properties", input: png, options: ["-format", "%r;%[channels];%k"], output: "info:/out", expected: Buffer.from("DirectClass sRGB ;srgb  3.0;4") },
        { name: "indexed gamma pixels", input: png, options: ["-depth", "8"], output: "rgba:/out", expected: Buffer.from("f7325cff73e491ff5a91f4fffde55aff", "hex") },
        { name: "direct gamma cycle", input: ppm, options: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: Buffer.from("fde55aff5a91f4fff7325cff73e491ff", "hex") },
    ])(`${mode}: $name`, async ({ input, options, output, expected }) => {
        const files = new Map<string, Uint8Array>([["/in", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in", "-gamma", "2", ...options, output];
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
