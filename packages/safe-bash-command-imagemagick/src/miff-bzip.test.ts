import { spawnSync } from "node:child_process";
import { boundedCodec } from "safe-bash-compression-engine/bounded-codec";
import { CodecReader } from "safe-bash-compression-engine/codec";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const compression of ["BZip", "reset"] as const) {
        it.each(["final", "-write", "+write"])(`${mode} writes ${compression} MIFF through %s`, async output => {
            const pixels = Uint8Array.of(18, 52, 86, 128, 171, 205, 239, 0);
            const { data } = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: pixels }, { format: "png" });
            const files = new Map([["input.png", data]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", data);
            const args = ["input.png", "-compress", compression === "reset" ? "BZip" : compression, ...(compression === "reset" ? ["+compress"] : []), ...(output === "final" ? ["out.miff"] : [output, "out.miff", "out.png"])];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
            const end = bytes.indexOf(26) + 1;
            const expected = compression === "BZip" ? "BZip" : "None";
            expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain(`compression=${expected}\n`);
            if (compression === "BZip") {
                const chunks: Uint8Array[] = [];
                for (let offset = end; offset < bytes.length;) {
                    const size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
                    chunks.push(bytes.subarray(offset + 4, offset + 4 + size));
                    offset += 4 + size;
                    expect(offset).toBeLessThanOrEqual(bytes.length);
                }
                const signal = new AbortController().signal;
                const reader = new CodecReader((async function* () { yield* chunks; })(), signal);
                const decoded: Uint8Array[] = [];
                try {
                    for await (const chunk of boundedCodec(reader, { format: "bzip2", decompress: true, level: 9 }, signal)) decoded.push(chunk);
                } finally { await reader.close(); }
                expect(new Uint8Array(Buffer.concat(decoded))).toEqual(pixels);
            } else expect(bytes.subarray(end)).toEqual(pixels);
            if (nativeMagick) {
                const identified = spawnSync("magick", ["identify", "-format", "%C", "miff:-"], { input: bytes });
                expect(identified.status).toBe(0);
                expect(identified.stdout.toString()).toBe(expected);
                const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
                expect(decoded.status).toBe(0);
                expect(new Uint8Array(decoded.stdout)).toEqual(pixels);
            }
        });
    }
}
