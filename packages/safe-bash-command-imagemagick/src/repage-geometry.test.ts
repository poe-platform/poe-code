import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

// ImageMagick 7.1.2 rejects these repage arguments without touching the output.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        [["-repage", "4x3+1q+1"], false],
        [["-repage", "junk"], false],
        [["-repage", "A4"], false],
        [["-repage", "7x4+2+1", "-repage", "3+2"], false],
        [["-repage", "5x4+1+0"], true],
        [["-page", "5x4+1+0"], true],
        [["-set", "page", "junk"], true],
    ] as const)(`validates repage without changing page settings via ${mode}: %j`, async (options, valid) => {
        const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);
        const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        for (const destination of ["PNG32:/out.png", "info:"]) {
            const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", keep]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            await filesystem.writeFile("/out.png", keep);
            const args = ["/input.png", ...options, "-format", "%wx%h|%g", destination];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "", exitCode: number;
            if (mode === "public") {
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                exitCode = result.exitCode;
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                ({ exitCode, stdout, stderr } = result);
            }
            expect(exitCode).toBe(valid ? 0 : 1);
            const output = mode === "retained" || mode === "public" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            if (!valid) {
                expect(stderr).toContain("invalid argument for option '-repage'");
                expect(stderr).toContain(options[options.length - 1]);
                expect(stdout).toBe("");
                expect(output).toEqual(keep);
            } else if (destination === "info:") {
                expect(stdout).toBe(options[0] !== "-set" ? "3x2|5x4+1+0" : "3x2|3x2+0+0");
                expect(output).toEqual(keep);
            } else {
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([3, 2]);
                expect(image.data).toEqual(decodeImage(input).data);
                if (options[0] !== "-set") expect(image.virtualCanvas).toEqual({ width: 5, height: 4, x: 1, y: 0 });
            }
        }
    });
}
