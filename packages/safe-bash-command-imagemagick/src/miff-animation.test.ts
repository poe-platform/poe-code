import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`preserves MIFF frame timing, disposal and loops in ${mode}`, async () => {
        const input = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            data: Uint8Array.of(18, 52, 86, 255) }, { format: "png" }).data;
        const files = new Map([["rgb.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/rgb.png", input);
        const args = ["-delay", "7", "-dispose", "Background", "rgb.png", "-delay", "19", "-dispose", "Previous", "rgb.png", "-loop", "3", "-write", "first.miff", "out.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const path of ["first.miff", "out.miff"]) {
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path)!;
            const headers = new TextDecoder().decode(bytes);
            expect(headers).toContain("delay=7\n");
            expect(headers).toContain("delay=19\n");
            expect(headers.split("iterations=3")).toHaveLength(3);
            expect(headers).toContain("dispose=Background\n");
            expect(headers).toContain("dispose=Previous\n");
            if (nativeMagick) {
                const identified = spawnSync("magick", ["identify", "-format", "%T %D\n", "miff:-"], { input: bytes });
                expect(identified.status).toBe(0);
                expect(identified.stdout.toString()).toBe("7 Background\n19 Previous\n");
                const verbose = spawnSync("magick", ["identify", "-verbose", "miff:-"], { input: bytes });
                expect(verbose.status).toBe(0);
                expect(verbose.stdout.toString().split("Iterations: 3")).toHaveLength(3);
            }
        }
    });
}
