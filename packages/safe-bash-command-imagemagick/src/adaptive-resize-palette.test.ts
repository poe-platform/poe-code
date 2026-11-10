import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 4\n255\n"),
    Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256)),
]);

// ImageMagick 7.1.2-35 Q16-HDRI references, including unchanged-size controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "4x3!", expected: "4x3,4x3+0+0,DirectClass sRGB " },
        { geometry: "7x6!", expected: "7x6,7x6+0+0,DirectClass sRGB " },
        { geometry: "5x4!", expected: "5x4,5x4+0+0,PseudoClass sRGB " },
        { geometry: "4x3!", size: 36, hash: "71f17abe55782717d8dc0eb8aa269cf81a2b8a099c74108bde6b74959afaa989" },
        { geometry: "5x4!", size: 60, hash: "580aee34359919ae57d3d023576cabb515acda4af357b5a6743ed93d98a86a61" },
    ])(`adaptively resizes reduced palettes to $geometry (${mode})`, async ({ geometry, expected, size, hash }) => {
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", "+dither", "-colors", "4", "-adaptive-resize", geometry, ...(expected === undefined ? ["-depth", "8", "rgb:/out"] : ["-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        if (expected === undefined) {
            expect(output).toHaveLength(size!);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        } else {
            expect(new TextDecoder().decode(output)).toBe(expected);
        }
    });
}
