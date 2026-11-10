import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const pixels = Uint8Array.from({ length: 3 * 9 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (i - Math.floor(i / 4)) + 1) % 256);
const input = encodeImage({ width: 3, height: 9, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data;

// ImageMagick 7.1.2-35 chooses the interlacing scheme from the output format.
for (const mode of ["command", "sync"] as const) for (const format of ["png", "gif", "jpg"]) {
    it.each([
        { options: ["-interlace", "Plane"], interlaced: true },
        { options: ["-interlace", "Line"], interlaced: true },
        { options: ["-interlace", "PNG"], interlaced: true },
        { options: ["-interlace", "GIF"], interlaced: true },
        { options: ["-interlace", "pNg"], interlaced: true },
        { options: ["-interlace", "None"], interlaced: false },
        { options: ["-interlace", "Plane", "+interlace"], interlaced: true },
        { options: [], interlaced: false }
    ])(`selects ${format} interlacing without changing pixels (${mode}, $options)`, async ({ options, interlaced }) => {
        const paths = [`/write.${format}`, `/plain.${format}`, `/final.${format}`];
        const files = new Map([["/in.png", input], ...paths.map(path => [path, new TextEncoder().encode("KEEP")] as const)]);
        const argv = ["/in.png", ...options, "-write", paths[0]!, "-interlace", "None", "-write", paths[1]!, ...options, paths[2]!];
        if (mode === "sync") {
            expect(runMagickCliSync(argv, files)).toMatchObject({ exitCode: 0, stderr: "" });
        } else {
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            for (const path of paths) files.set(path, await fs.readFile(path));
        }
        const plain = await sharp(files.get(paths[1]!)!).ensureAlpha().raw().toBuffer();
        for (const [index, path] of paths.entries()) {
            const bytes = files.get(path)!;
            const enabled = index !== 1 && interlaced;
            if (format === "gif") {
                let offset = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
                while (bytes[offset] === 33) {
                    offset += 2;
                    while (bytes[offset]) offset += bytes[offset]! + 1;
                    offset++;
                }
                expect(bytes[offset]).toBe(44);
                expect(Boolean(bytes[offset + 9]! & 64)).toBe(enabled);
            } else {
                expect((await sharp(bytes).metadata()).isProgressive).toBe(enabled);
            }
            expect(await sharp(bytes).ensureAlpha().raw().toBuffer()).toEqual(plain);
            if (format !== "jpg") expect(new Uint8Array(plain)).toEqual(pixels);
        }
    });
}
