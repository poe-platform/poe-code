import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

for (const execution of ["sync", "buffered", "retained"] as const) {
    it.each(["garbage", "", "Undefined"])(`${execution}: rejects montage mode %j without writing output`, async mode => {
        const input = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        for (const existing of [false, true]) {
            const files = new Map([["a.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/a.png", input);
            if (existing) {
                files.set("sheet.png", input);
                await filesystem.writeFile("/sheet.png", input);
            }
            const args = ["-geometry", "+0+0", "-mode", mode, "a.png", "sheet.png"];
            const result = execution === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("unrecognized image mode");
            expect(files.get("sheet.png")).toEqual(existing ? input : undefined);
            if (existing) expect(await filesystem.readFile("/sheet.png")).toEqual(input);
            else expect(await filesystem.readdir("/")).toEqual([{ name: "a.png", type: "file" }]);
        }
    });

    it.each(["Frame", "Unframe", "Concatenate", "uNfRaMe"])(`${execution}: retains montage mode %s`, async mode => {
        const input = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const files = new Map([["a.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", input);
        const args = ["-geometry", "+0+0", "-mode", mode, "a.png", "sheet.png"];
        const result = execution === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = execution === "retained" ? await filesystem.readFile("/sheet.png") : files.get("sheet.png")!;
        const image = decodeImage(output);
        if (mode !== "Frame") {
            expect([image.width, image.height]).toEqual([2, 1]);
            expect([...image.data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
        } else {
            expect(image.width).toBeGreaterThan(2);
            expect(image.height).toBeGreaterThan(1);
        }
    });
}
