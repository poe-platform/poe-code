import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI converts CMYK to sRGB when cycling.
    it.each([
        { operations: ["-cycle", "1", "-depth", "8", "rgba:/out"], expected: "34cc53fffbcd20fff00a21ff2053eaff", encoding: "hex" },
        { operations: ["-cycle", "1", "-format", "%r;%[channels];%k", "info:/out"], expected: "PseudoClass sRGB ;srgb  4.0;4", encoding: "utf8" },
        { operations: ["-format", "%r;%[channels];%k", "info:/out"], expected: "DirectClass CMYK ;cmyk  4.0;4", encoding: "utf8" },
        { operations: ["-depth", "8", "rgba:/out"], expected: "f00a21ff34cc53ff2053eafffbcd20ff", encoding: "hex" }
    ] as const)(`${mode} matches native CMYK output for $operations`, async ({ operations, expected, encoding }) => {
        const files = new Map<string, Uint8Array>([["/a.ppm", ppm], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/a.ppm", "-colorspace", "CMYK", ...operations];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect(Buffer.from(output).toString(encoding)).toBe(expected);
    });
}
