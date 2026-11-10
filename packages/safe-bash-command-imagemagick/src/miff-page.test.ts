import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["sync", "command"] as const) {
    it.each(["8x6+2+3", "8x6-2-3", "0x0+2-3"])(`${mode} preserves MIFF page %s without changing pixels`, async page => {
        const pixels = Uint8Array.of(18, 52, 86, 255, 171, 205, 239, 255);
        const { data } = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: pixels }, { format: "png" });
        const files = new Map([["input.png", data]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", data);
        const args = ["input.png", "-repage", page, "out.miff"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
        expect(result.exitCode).toBe(0);
        const bytes = mode === "sync" ? files.get("out.miff")! : await filesystem.readFile("/out.miff");
        const end = bytes.indexOf(26) + 1;
        const expectedPage = page === "0x0+2-3" ? "4x0+2-3" : page;
        expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain(`page=${expectedPage}\n`);
        expect(bytes.subarray(end)).toEqual(pixels);
        if (nativeMagick) {
            const identified = spawnSync("magick", ["identify", "-format", "%w %h %g", "miff:-"], { input: bytes });
            expect(identified.status, identified.stderr.toString()).toBe(0);
            expect(identified.stdout.toString()).toBe(`2 1 ${page === "0x0+2-3" ? "4x1+2-3" : page}`);
            const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
            expect(decoded.status).toBe(0);
            expect(new Uint8Array(decoded.stdout)).toEqual(pixels);
        }
    });
}
