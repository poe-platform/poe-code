import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync", "buffered", "retained"] as const) {
    it.each([
        { colors: ["#808080", "red"], values: [[128, 128, 128, 255, 255, 0, 0, 255]], channels: [3], options: ["+append"] },
        { depth: 16, colors: ["#808080808081"], values: [[128, 128, 128, 255]], channels: [3], options: [] },
        { colors: ["white"], values: [[255, 255, 255, 255]], channels: [1], options: [] },
        { colors: ["black"], values: [[0, 0, 0, 255]], channels: [1], options: [] },
        { colors: ["red", "#808080"], values: [[255, 0, 0, 255], [128, 128, 128, 255]], channels: [3, 1], options: [] },
        { colors: ["#808080", "red"], values: [[128, 128, 128, 255], [255, 0, 0, 255]], channels: [1, 3], options: [] },
        { colors: ["#808080"], values: [[128, 128, 128, 255]], channels: [1], options: ["-colorspace", "Gray"] },
        { colors: ["white"], values: [[255, 255, 255, 255]], channels: [3], options: ["-type", "TrueColor"] },
        { colors: ["#80808080"], values: [[128, 128, 128, 128]], channels: [2], options: [] },
    ])(`writes neutral TIFF pages without changing pixels (${mode}, %j)`, async ({ colors, values, channels, options, depth = 8 }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = [...colors.map(color => `xc:${color}`), ...options, "-depth", String(depth), "-write", "/copy.tif", mode === "public" ? "tiff:-" : "/out.tif"];
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "public" ? new Uint8Array(Buffer.concat(chunks)) : mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
        const copy = mode === "public" || mode === "retained" ? await filesystem.readFile("/copy.tif") : files.get("/copy.tif")!;
        for (const bytes of [output, copy]) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
            let directory = view.getUint32(4, little);
            for (const [page, count] of channels.entries()) {
                expect(directory).toBeGreaterThan(0);
                const entries = view.getUint16(directory, little), tags = new Map<number, number[]>();
                for (let i = 0; i < entries; i++) {
                    const entry = directory + 2 + i * 12, tag = view.getUint16(entry, little);
                    if (![258, 262, 277].includes(tag)) continue;
                    const length = view.getUint32(entry + 4, little), offset = length <= 2 ? entry + 8 : view.getUint32(entry + 8, little);
                    tags.set(tag, Array.from({ length }, (_, index) => view.getUint16(offset + index * 2, little)));
                }
                expect(tags.get(262)).toEqual([count < 3 ? 1 : 2]);
                expect(tags.get(277)).toEqual([count]);
                expect(tags.get(258)).toEqual(Array(count).fill(depth));
                expect(Array.from(decodeImage(bytes, { page }).data)).toEqual(values[page]);
                directory = view.getUint32(directory + 2 + entries * 12, little);
            }
            expect(directory).toBe(0);
        }
    });
}
