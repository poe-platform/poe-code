import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI accepts a signed number after an offset sign.
const pixels = Buffer.from("ff000000ff000000ffffff0000ffffff00ff", "hex");
const cases = [
    { args: ["/in.png", "-repage", "3x2+1+-1"], page: "3x2+1-1", width: 3, height: 2 },
    { args: ["-page", "3x2+1+-1", "/in.png"], page: "3x2+1-1", width: 3, height: 2 },
    { args: ["/in.png", "-repage", "7x4+2+1", "-set", "page", "4x3+1+-2"], page: "4x3+1-2", width: 4, height: 3 },
    { args: ["/in.png", "-repage", "3x2+1-1"], page: "3x2+1-1", width: 3, height: 2 },
    { args: ["-page", "3x2+1-1", "/in.png"], page: "3x2+1-1", width: 3, height: 2 },
    { args: ["/in.png", "-repage", "7x4+2+1", "-set", "page", "4x3+1-2"], page: "4x3+1-2", width: 4, height: 3 },
];

for (const mode of ["sync", "public", "buffered", "retained"] as const) {
    for (const output of ["info", "png", "flatten"] as const) {
        it.each(cases)(`${mode} ${output} preserves signed page offsets: $args`, async ({ args, page, width, height }) => {
            const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, data] of files) await fs.writeFile(path, data);
            const argv = [...args, ...(output === "flatten" ? ["-background", "black", "-flatten"] : []),
                ...(output === "info" ? ["-format", "%wx%h|%g", "info:"] : ["PNG32:/out.png"])];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            if (output === "info") {
                expect("stdout" in result ? result.stdout : stdout).toBe(`3x2|${page}`);
                expect(bytes).toEqual(keep);
                return;
            }
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual(output === "flatten" ? [width, height] : [3, 2]);
            expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 }).toEqual({
                width, height, x: output === "flatten" ? 0 : 1, y: output === "flatten" ? 0 : height === 2 ? -1 : -2,
            });
            if (output === "png") {
                expect(image.data).toEqual(decodeImage(input).data);
            } else {
                const expected = new Uint8Array(width * height * 4);
                for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
                if (height === 2) expected.set([255, 255, 0, 255, 0, 255, 255, 255], 4);
                expect(image.data).toEqual(expected);
            }
        });
    }
}
