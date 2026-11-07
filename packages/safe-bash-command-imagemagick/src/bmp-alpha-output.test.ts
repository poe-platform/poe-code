import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const variant of ["default", "bmp3", "bmp3-alpha", "bmp3-opaque", "rgb", "reset"] as const) {
        it(`preserves BMP pixel channels (${mode}, ${variant})`, async () => {
            const opaque = variant === "rgb";
            const input = sharp(new Uint8Array(opaque ? [255, 0, 0, 0, 255, 0, 0, 0, 255] : [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]), { raw: { width: 3, height: 1, channels: opaque ? 3 : 4 } }).png().toBufferSync();
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const defines = variant.startsWith("bmp3") || variant === "reset" ? ["-define", "bmp:format=bmp3"] : [];
            if (variant === "bmp3-alpha" || variant === "reset") defines.push("-define", "bmp3:alpha=true");
            if (variant === "bmp3-opaque") defines.push("-define", "bmp3:alpha=false");
            if (variant === "reset") defines.push("+define", "bmp:format", "+define", "bmp3:alpha");
            const result = mode === "sync" ? runConvertCliSync(["/in.png", ...defines, "-write", "/copy.bmp", "/out.bmp"], files) : await runConvertCli(["/in.png", ...defines, "-write", "/copy.bmp", "/out.bmp"], mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            for (const path of ["/copy.bmp", "/out.bmp"]) {
                const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const alpha = ["default", "bmp3-alpha", "reset"].includes(variant);
                expect(view.getUint16(28, true)).toBe(alpha ? 32 : 24);
                expect(view.getUint32(30, true)).toBe(alpha && variant !== "bmp3-alpha" ? 3 : 0);
                if (alpha && variant !== "bmp3-alpha") expect(view.getUint32(66, true)).toBe(0xff000000);
                if (variant.startsWith("bmp3")) expect(view.getUint32(14, true)).toBe(40);
                const start = view.getUint32(10, true);
                expect(Array.from(bytes.subarray(start, start + (alpha ? 12 : 9)))).toEqual(alpha ? [0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 0] : [0, 0, 255, 0, 255, 0, 255, 0, 0]);
            }
        });
    }
}
