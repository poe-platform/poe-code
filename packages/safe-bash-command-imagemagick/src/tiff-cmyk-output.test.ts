import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([false, true])(`writes separated ink samples alongside an RGB page (${mode}, alpha=%s)`, async alpha => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [alpha ? "xc:cmyka(10%,20%,30%,40%,0.5)" : "xc:cmyk(10%,20%,30%,40%)", "xc:red", "-depth", "8", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let directory = view.getUint32(4, true);
        for (const page of [0, 1]) {
            const tags = new Map<number, number>();
            const count = view.getUint16(directory, true);
            for (let i = 0; i < count; i++) {
                const at = directory + 2 + i * 12;
                tags.set(view.getUint16(at, true), view.getUint16(at + 2, true) === 3 && view.getUint32(at + 4, true) === 1 ? view.getUint16(at + 8, true) : view.getUint32(at + 8, true));
            }
            expect(tags.get(262)).toBe(page === 0 ? 5 : 2);
            expect(tags.get(277)).toBe(page === 0 ? alpha ? 5 : 4 : 3);
            expect(tags.get(338)).toBe(page === 0 && alpha ? 2 : undefined);
            const offset = tags.get(273)!;
            expect(Array.from(bytes.subarray(offset, offset + tags.get(277)!))).toEqual(page === 0 ? alpha ? [26, 51, 77, 102, 128] : [26, 51, 77, 102] : [255, 0, 0]);
            directory = view.getUint32(directory + 2 + count * 12, true);
        }
        if (nativeAvailable) {
            const native = spawnSync("magick", ["tiff:-[0]", "-depth", "8", alpha ? "cmyka:-" : "cmyk:-"], { input: bytes });
            expect(native.status, native.stderr.toString()).toBe(0);
            expect(Array.from(native.stdout)).toEqual(alpha ? [26, 51, 77, 102, 128] : [26, 51, 77, 102]);
        }
    });
}

it("writes existing ink through the public command on a fresh filesystem", async () => {
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["xc:cmyk(10%,20%,30%,40%)", "-depth", "8", "tiff:-"]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "binary") : new Uint8Array(chunk)); } },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(Array.from(Buffer.concat(chunks).subarray(8, 12))).toEqual([26, 51, 77, 102]);
});

it.skipIf(!nativeAvailable).each(["None", "LZW", "Zip", "RLE"])("preserves ink across tiled planar strips (%s)", async compression => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "17x2", "xc:cmyka(10%,20%,30%,40%,0.5)", "-depth", "8", "-interlace", "Plane", "-define", "tiff:tile-geometry=16x16", "-compress", compression, "/out.tif"];
    expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = await filesystem.readFile("/out.tif");
    expect(bytes).toEqual(files.get("/out.tif"));
    const native = spawnSync("magick", ["tiff:-", "-depth", "8", "cmyka:-"], { input: bytes });
    expect(native.status, native.stderr.toString()).toBe(0);
    expect(Array.from(native.stdout)).toEqual(Array.from({ length: 34 }, () => [26, 51, 77, 102, 128]).flat());
});
