import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]]) {
        it(`${mode} rejects empty-list ${operation.join(" ")} without replacing the destination`, async () => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const args = [...operation, "-size", "2x1", "xc:#3070b080", "-repage", "3x2+0+0", "-depth", "8", "rgba:out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(`no images found for operation '${operation[0]}'`);
            expect(mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")).toEqual(keep);
        });
    }
    it(`${mode} retains valid single-image flatten compositing`, async () => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["xc:#3070b080", "-background", "#206030", "-compose", "Over", "-flatten", "-depth", "8", "rgba:out"];
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
            args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} } })
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")).toEqual(Uint8Array.of(0x28, 0x68, 0x70, 0xff));
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const reverse of [false, true]) {
        for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]]) {
            it(`${mode} ${operation.join(" ")} ${reverse ? "blue first" : "red first"} clips to the appropriate canvas`, async () => {
                const files = new Map<string, Uint8Array>();
                for (const [name, width, height, color] of [
                    ["red.png", 3, 2, [255, 0, 0, 128]],
                    ["blue.png", 2, 3, [0, 0, 255, 128]]
                ] as const) {
                    files.set(name, await sharp(Uint8Array.from(Array.from({ length: width * height }, () => [...color]).flat()), { raw: { width, height, channels: 4 } }).png().toBuffer());
                }
                const fs = new MemoryFileSystem();
                for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
                const inputs = reverse ? ["blue.png", "red.png"] : ["red.png", "blue.png"];
                const args = [...inputs, "-background", "white", ...operation, "out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
                const flatten = operation.includes("-flatten") || operation.includes("flatten");
                expect([image.width, image.height]).toEqual(flatten ? reverse ? [2, 3] : [3, 2] : [3, 3]);
                for (let y = 0; y < image.height; y++) {
                    for (let x = 0; x < image.width; x++) {
                        const expected = x < 2 && y < 2 ? reverse ? [191, 63, 127, 255] : [127, 63, 191, 255]
                            : y < 2 ? [255, 127, 127, 255] : x < 2 ? [127, 127, 255, 255] : [255, 255, 255, 255];
                        expect([...image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)]).toEqual(expected);
                    }
                }
            });
        }
    }
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [["-flatten"], ["-layers", "flatten"]]) {
        it.each([
            { page: "10x12+2+3", width: 10, height: 12, x: 2, y: 3 },
            { page: "2x2-1-1", width: 2, height: 2, x: -1, y: -1 },
            { page: undefined, width: 3, height: 2, x: 0, y: 0 }
        ])(`${mode} ${operation.join(" ")} places a single image on $page`, async ({ page, width, height, x, y }) => {
            const values = [10, 49, 100, 150, 200, 245];
            const bytes = await sharp(Uint8Array.from(values.flatMap(value => [value, value, value, 255])), { raw: { width: 3, height: 2, channels: 4 } }).png().toBuffer();
            const files = new Map([["in.png", bytes]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const args = ["in.png", ...(page ? ["-repage", page] : []), "-background", "black", ...operation, "out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const image = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect([image.width, image.height]).toEqual([width, height]);
            for (let row = 0; row < height; row++) {
                for (let col = 0; col < width; col++) {
                    const sx = col - x, sy = row - y;
                    const value = sx >= 0 && sx < 3 && sy >= 0 && sy < 2 ? values[sy * 3 + sx]! : 0;
                    expect([...image.data.subarray((row * width + col) * 4, (row * width + col + 1) * 4)]).toEqual([value, value, value, 255]);
                }
            }
        });
    }
}
