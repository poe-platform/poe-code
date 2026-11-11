import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const rgb = Uint8Array.of(0x12, 0x34, 0x56, 0x23, 0x45, 0x67, 0x34, 0x56, 0x78);
const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), rgb]);
const pixels = Uint8Array.of(0x12, 0x34, 0x56, 255, 0x23, 0x45, 0x67, 255, 0x34, 0x56, 0x78, 255);
function directory(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
    const offset = view.getUint32(4, little), tags = new Map<number, number>();
    for (let i = 0; i < view.getUint16(offset, little); i++) {
        const at = offset + 2 + i * 12;
        tags.set(view.getUint16(at, little), view.getUint16(at + 2, little) === 3 ? view.getUint16(at + 8, little) : view.getUint32(at + 8, little));
    }
    return { tags, strip: bytes.slice(tags.get(273)!, tags.get(273)! + tags.get(279)!) };
}
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["None", "Zip", "LZW", "RLE", "JPEG"])(`${mode}: writes TIFF FillOrder and encoded %s strip bytes`, async compression => {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const run = async (argv: string[]) => {
            const chunks: Uint8Array[] = [], argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result: { exitCode: number; stderr?: string; stdoutBytes?: Uint8Array } = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            return mode === "command" ? new Uint8Array(Buffer.concat(chunks)) : result.stdoutBytes!;
        };
        const lsb = await run(["/in.ppm", "-compress", compression, "-define", "tiff:fill-order=msb", "-write", "/msb.tif",
            "-define", "tiff:fill-order=LSB", "-write", "/lsb.tif", "+define", "tiff:fill-order", "-write", "/reset.tif",
            "-define", "tiff:fill-order=lsb", "tiff:-"]);
        const read = async (path: string) => mode === "command" || mode === "retained" ? fs.readFile(path) : files.get(path)!;
        const msb = directory(await read("/msb.tif")), least = directory(lsb);
        expect(msb.tags.get(266) ?? 1).toBe(1);
        expect(least.tags.get(266)).toBe(2);
        expect(least.tags.get(259)).toBe(msb.tags.get(259));
        expect(least.tags.get(317) ?? 1).toBe(msb.tags.get(317) ?? 1);
        // Native ImageMagick reverses encoded bytes, except for the embedded JPEG stream.
        expect(least.strip).toEqual(compression === "JPEG" ? msb.strip : msb.strip.map(byte => Number.parseInt(byte.toString(2).padStart(8, "0").split("").reverse().join(""), 2)));
        expect(await read("/lsb.tif")).toEqual(lsb);
        expect(await read("/reset.tif")).toEqual(await read("/msb.tif"));
        if (compression === "None") expect(least.strip).toEqual(Uint8Array.of(0x48, 0x2c, 0x6a, 0xc4, 0xa2, 0xe6, 0x2c, 0x6a, 0x1e));
        if (compression !== "JPEG") {
            expect(decodeImage(lsb).data).toEqual(pixels);
            expect(await run(["/lsb.tif", "-depth", "8", "rgb:-"])).toEqual(rgb);
        }
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each([
        { format: "TIFF", options: ["-depth", "16", "-define", "tiff:endian=msb"] },
        { format: "TIFF", options: ["-depth", "32", "-define", "quantum:format=floating-point"] },
        { format: "TIFF", options: ["-interlace", "Plane", "-compress", "LZW"] },
        { format: "TIFF64", options: ["-define", "tiff:tile-geometry=16x16", "-compress", "Zip", "-define", "tiff:endian=msb"] }
    ])(`${mode}: preserves LSB pixels across linked $format pages with $options`, async ({ format, options }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "/in.ppm", ...options, "-define", "tiff:fill-order=lsb", "-write", `${format}:/copy.tif`, `${format}:/out.tif`];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "sync" ? files.get(path)! : await filesystem.readFile(path);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73, big = format === "TIFF64";
            let offset = big ? Number(view.getBigUint64(8, little)) : view.getUint32(4, little);
            for (const page of [0, 1]) {
                expect(offset).toBeGreaterThan(0);
                const count = big ? Number(view.getBigUint64(offset, little)) : view.getUint16(offset, little);
                let fillOrder = 1;
                for (let i = 0; i < count; i++) {
                    const at = offset + (big ? 8 : 2) + i * (big ? 20 : 12);
                    if (view.getUint16(at, little) === 266) fillOrder = view.getUint16(at + (big ? 12 : 8), little);
                }
                expect(fillOrder).toBe(2);
                expect(decodeImage(bytes, { page }).data).toEqual(pixels);
                const next = offset + (big ? 8 : 2) + count * (big ? 20 : 12);
                offset = big ? Number(view.getBigUint64(next, little)) : view.getUint32(next, little);
            }
            expect(offset).toBe(0);
        }
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`${mode}: propagates FillOrder to separate frame writes`, async () => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "/in.ppm", "-define", "tiff:fill-order=lsb", "+adjoin", "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy-0.tif", "/copy-1.tif", "/out-0.tif", "/out-1.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            expect(directory(bytes).tags.get(266)).toBe(2);
            expect(decodeImage(bytes).data).toEqual(pixels);
        }
    });
}
