import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const options of [[], ["-endian", "MSB"], ["-define", "tiff:format=64"], ["-define", "tiff:format=64", "-endian", "MSB"]]) {
    it.each([5, 6])(`writes every combined sample in ${mode} TIFF output (%i planes, ${options.join(" ")})`, async count => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const names = Array.from({ length: count }, (_, i) => `p${i}.pgm`);
        for (const [i, name] of names.entries()) {
            const bytes = new Uint8Array([...new TextEncoder().encode("P5\n4 2\n255\n"), ...Array.from({ length: 8 }, (_, j) => (41 * i + 13 * j + 5) % 256)]);
            files.set(name, bytes);
            await filesystem.writeFile(`/${name}`, bytes);
        }
        const args = [...names, "-combine", ...options, "out.tiff"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.tiff") : files.get("out.tiff")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
        const big = view.getUint16(2, little) === 43;
        const offsetSize = big ? 8 : 4;
        const offset = (at: number) => big ? Number(view.getBigUint64(at, little)) : view.getUint32(at, little);
        const directory = offset(big ? 8 : 4), tags = new Map<number, number[]>();
        const entries = big ? offset(directory) : view.getUint16(directory, little);
        for (let i = 0; i < entries; i++) {
            const entry = directory + (big ? 8 : 2) + i * (big ? 20 : 12), type = view.getUint16(entry + 2, little), length = offset(entry + 4);
            const size = type === 3 ? 2 : type === 16 ? 8 : 4, value = entry + (big ? 12 : 8);
            const at = length * size <= offsetSize ? value : offset(value);
            tags.set(view.getUint16(entry, little), Array.from({ length }, (_, j) => size === 2 ? view.getUint16(at + j * size, little) : size === 8 ? Number(view.getBigUint64(at + j * size, little)) : view.getUint32(at + j * size, little)));
        }
        expect(tags.get(277)).toEqual([count]);
        expect(tags.get(258)).toEqual(Array(count).fill(8));
        expect(tags.get(338)).toEqual([2, ...Array(count - 4).fill(0)]);
        const start = tags.get(273)![0]!;
        expect([...bytes.subarray(start, start + count * 8)]).toEqual(Array.from({ length: 8 }, (_, j) => Array.from({ length: count }, (_, i) => (41 * i + 13 * j + 5) % 256)).flat());
    });
}
}
