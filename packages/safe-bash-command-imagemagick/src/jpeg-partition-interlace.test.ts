import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const pixels = Uint8Array.from({ length: 3 * 9 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (i - Math.floor(i / 4)) + 1) % 256);
const input = encodeImage({ width: 3, height: 9, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data;

// Native ImageMagick uses format-specific interlacing for JPEG and Partition;
// TIFF alone distinguishes chunky JPEG from planar Partition.
for (const mode of ["command", "sync"] as const) for (const format of ["png", "gif", "jpg", "tif"]) {
    it.each(["JPEG", "Partition", "jPeG", "pArTiTiOn", "Plane"])(`encodes ${format} with %s interlace (${mode})`, async interlace => {
        const paths = [`/write.${format}`, `/plain.${format}`, `/final.${format}`];
        const files = new Map([["/in.png", input], ...paths.map(path => [path, new TextEncoder().encode("KEEP")] as const)]);
        const argv = ["/in.png", "-interlace", interlace, "-write", paths[0]!, "-interlace", "None", "-write", paths[1]!, "-interlace", interlace, paths[2]!];
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
            const enabled = index !== 1;
            if (format === "gif") {
                let offset = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
                while (bytes[offset] === 33) {
                    offset += 2;
                    while (bytes[offset]) offset += bytes[offset]! + 1;
                    offset++;
                }
                expect(bytes[offset]).toBe(44);
                expect(Boolean(bytes[offset + 9]! & 64)).toBe(enabled);
            } else if (format === "tif") {
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
                const ifd = view.getUint32(4, little);
                let planar: number | undefined;
                for (let i = 0; i < view.getUint16(ifd, little); i++) {
                    const at = ifd + 2 + i * 12;
                    if (view.getUint16(at, little) === 284) planar = view.getUint16(at + 8, little);
                }
                expect(planar).toBe(enabled && interlace.toLowerCase() !== "jpeg" ? 2 : 1);
            } else {
                expect((await sharp(bytes).metadata()).isProgressive).toBe(enabled);
            }
            expect(await sharp(bytes).ensureAlpha().raw().toBuffer()).toEqual(plain);
            if (format !== "jpg") expect(new Uint8Array(plain)).toEqual(pixels);
        }
    });
}
