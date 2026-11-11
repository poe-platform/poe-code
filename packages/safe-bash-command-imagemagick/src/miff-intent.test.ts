import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["Relative", "Absolute", "Perceptual", "Saturation"])(`writes %s rendering intent in ${mode} MIFF output`, async intent => {
        const input = encodeImage({ width: 3, height: 2, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 238, 0, 255, 153, 17, 119, 255, 36, 83, 132, 255) }, { format: "png" }).data;
        const files = new Map([["plain.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/plain.png", input);
        const args = ["-intent", intent.toLowerCase(), "plain.png", "-write", "before.miff", "-intent", intent, "-write", "explicit.miff", "+intent", "reset.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const path of ["before.miff", "explicit.miff", "reset.miff"]) {
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path)!;
            const header = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)));
            if (path === "reset.miff") expect(header).not.toContain("rendering-intent=");
            else expect(header).toContain(`rendering-intent=${intent}\n`);
            if (nativeMagick && path !== "reset.miff") {
                const identified = spawnSync("magick", ["miff:-", "miff:-"], { input: bytes });
                expect(identified.status).toBe(0);
                const nativeHeader = identified.stdout.subarray(0, identified.stdout.indexOf(26)).toString();
                expect(nativeHeader).toContain(`rendering-intent=${intent}`);
            }
        }
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["bmp", "miff"] as const)(`preserves input %s rendering intent in ${mode} MIFF output`, async format => {
        const input = encodeImage({ width: 1, height: 1, format, space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            renderingIntent: "Relative", data: Uint8Array.of(255, 0, 0, 255) }, { format, bmpFormat: "bmp4" }).data;
        if (format === "bmp") new DataView(input.buffer, input.byteOffset, input.byteLength).setUint32(122, 2, true);
        const path = `input.${format}`, files = new Map([[path, input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile(`/${path}`, input);
        const args = [path, "out.miff"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
        expect(new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)))).toContain("rendering-intent=Relative\n");
    });
}
