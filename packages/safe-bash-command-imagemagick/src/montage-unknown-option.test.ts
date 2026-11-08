import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["-frobozz", "+frobozz", undefined])(`${mode}: validates montage option %s before writing output`, async option => {
        const input = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const files = new Map([["a.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", input);
        const args = ["-geometry", "+0+0", ...(option ? [option] : []), "a.png", "sheet.png"];
        const result = mode === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if (option) {
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(`unrecognized option '${option}'`);
            expect(files.has("sheet.png")).toBe(false);
            expect(await filesystem.readdir("/")).toEqual([{ name: "a.png", type: "file" }]);
        } else {
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/sheet.png") : files.get("sheet.png")!;
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([2, 1]);
            expect([...image.data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
        }
    });
}
