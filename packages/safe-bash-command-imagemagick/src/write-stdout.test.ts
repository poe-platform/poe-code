import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "streamed", "command"] as const)("routes intermediate coder output to stdout (%s)", async mode => {
    for (const format of ["png", "gif"] as const) {
        for (const final of ["out.png", "png:-", "null:"]) {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
            const input = (mode === "buffered" || mode === "sync") ? files : { filesystem: fs, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } } } : {}) };
            const args = ["-size", "1x1", "xc:red", "-write", `${format}:-`, "-negate", "+write", `${format}:-`, final];
            const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "command" ? {
                ...await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } }),
                stdoutBytes: undefined
            } : await runConvertCli(args, input);
            expect(result.exitCode).toBe(0);
            const bytes = (mode === "streamed" || mode === "command") ? Uint8Array.from(chunks.flatMap(chunk => [...chunk])) : result.stdoutBytes!;
            expect(bytes).toBeDefined();
            // Decode each encoded stream, using PNG chunk framing / GIF trailer to split them.
            let offset = 0;
            const colors = final === "png:-" ? [[255, 0, 0, 255], [0, 255, 255, 255], [0, 255, 255, 255]] : [[255, 0, 0, 255], [0, 255, 255, 255]];
            for (let index = 0; index < colors.length; index++) {
                let end = offset;
                if (index < 2 && format === "gif") {
                    end += 13;
                    const packed = bytes[offset + 10]!;
                    if (packed & 128) end += 3 * (1 << ((packed & 7) + 1));
                    while (bytes[end] !== 0x3b) {
                        const block = bytes[end++];
                        if (block === 0x21) end++; // Extension label.
                        else {
                            expect(block).toBe(0x2c);
                            const descriptor = bytes[end + 8]!;
                            end += 9;
                            if (descriptor & 128) end += 3 * (1 << ((descriptor & 7) + 1));
                            end++; // LZW minimum code size.
                        }
                        while (bytes[end]) end += bytes[end]! + 1;
                        end++;
                    }
                    end++;
                } else {
                    end += 8;
                    while (true) {
                        const length = new DataView(bytes.buffer, bytes.byteOffset + end, 4).getUint32(0);
                        const type = new TextDecoder().decode(bytes.subarray(end + 4, end + 8));
                        end += length + 12;
                        if (type === "IEND") break;
                    }
                }
                expect([...decodeImage(bytes.subarray(offset, end)).data]).toEqual(colors[index]);
                offset = end;
            }
            expect(offset).toBe(bytes.length);
            expect(files.has("-")).toBe(false);
            expect((await fs.readdir("/")).some(entry => entry.name === "-")).toBe(false);
            if (final === "out.png") expect([...decodeImage((mode === "buffered" || mode === "sync") ? files.get(final)! : await fs.readFile("/out.png")).data]).toEqual([0, 255, 255, 255]);
        }
    }
});
