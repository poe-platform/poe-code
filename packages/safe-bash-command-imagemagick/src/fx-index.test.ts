import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const alpha of [80, 255]) {
        it.each(["u[1].g", "u[99].w", "u[w].g"])(`rejects %s with alpha ${alpha} via ${mode}`, async expression => {
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([64, 128, 192, alpha]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", "-fx", expression, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).not.toBe(0);
            expect(result.stderr).toContain("bad for ImgListLen 1");
            expect(files.has("out.png")).toBe(false);
            await expect(filesystem.stat("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
        });
    }
    it.each(["u[1].g", "u[-1].g"])(`reads a valid second image with %s via ${mode}`, async expression => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [name, green] of [["first.png", 128], ["second.png", 224]] as const) {
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([64, green, 192, 255]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            files.set(name, input);
            await filesystem.writeFile(`/${name}`, input);
        }
        const args = ["first.png", "second.png", "-channel", "RGB", "-fx", expression, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual([224, 224, 224, 255]);
    });
}
