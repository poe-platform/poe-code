import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = encodeImage({
    width: 4, height: 3,
    data: Uint8Array.from(Array.from({ length: 12 }, (_, i) => [i % 8 * 31, 40, 180, 255]).flat()),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
}, { format: "png", pngCoder: "png8" }).data;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operation: "-splice", expected: "DirectClass sRGB Alpha 8 5x4" },
        { operation: "-chop", expected: "PseudoClass sRGB  8 3x2" },
        { operation: undefined, expected: "PseudoClass sRGB  8 4x3" },
    ])(`reports native palette storage class after $operation, ${mode}`, async ({ operation, expected }) => {
        const files = new Map([["pal.png", input], ["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["pal.png", "-background", "none", ...(operation ? [operation, "1x1+1+1"] : []), "-format", "%r %z %wx%h", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(bytes)).toBe(expected);
    });
}
