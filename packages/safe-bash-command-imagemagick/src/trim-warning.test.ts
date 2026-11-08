import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "stream"] as const) {
    for (const foreground of [false, true]) {
        it(`warns only for an empty trim (mode=${mode}, foreground=${foreground})`, async () => {
            const pixels = new Uint8Array(9 * 7 * 4).fill(255);
            if (foreground) pixels.set([255, 0, 0, 255], (3 * 9 + 4) * 4);
            const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
            const files = new Map([["/white.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/white.png", input);
            let stderr = "";
            const backend = mode === "map" ? files : { filesystem, cwd: "/", ...(mode === "stream" ? {
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } : {}) };
            const result = await runMagickCli(["/white.png", "-trim", "/out.png"], backend);
            expect(result.exitCode).toBe(0);
            const warning = mode === "stream" ? stderr : result.stderr;
            if (foreground) expect(warning).toBe("");
            else expect(warning).toContain("geometry does not contain image");
            if (mode === "stream") expect(result.stderr).toBe("");
            const output = decodeImage(mode === "map" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
            expect(Array.from(output.data)).toEqual(foreground ? [255, 0, 0, 255] : [255, 255, 255, 0]);
        });
    }
}
