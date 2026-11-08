import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["PixelsPerInch", "PixelsPerCentimeter", "Undefined"])(`preserves both MIFF resolution axes and %s units in ${mode}`, async units => {
        const input = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            data: Uint8Array.of(18, 52, 86, 255, 171, 205, 239, 255) }, { format: "png" }).data;
        const files = new Map([["rgb.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/rgb.png", input);
        const args = ["rgb.png", "-units", units, "-density", "144x72", "-write", "first.miff", "-density", "96x48", "out.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [path, x, y] of [["first.miff", 144, 72], ["out.miff", 96, 48]] as const) {
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path)!;
            const header = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)));
            expect(header).toContain(`resolution=${x}x${y}\n`);
            expect(header).toContain(`units=${units}\n`);
            if (nativeMagick) {
                const identified = spawnSync("magick", ["identify", "-format", "%x,%y,%U", "miff:-"], { input: bytes });
                expect(identified.status).toBe(0);
                expect(identified.stdout.toString()).toBe(`${x},${y},${units}`);
            }
        }
    });
}
