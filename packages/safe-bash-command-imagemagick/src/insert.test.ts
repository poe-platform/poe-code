import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Positions and bounds verified against native ImageMagick 7.
    it.each([
        { args: ["r.png", "g.png", "b.png", "-insert", "-1"], pixels: [red, blue, green] },
        { args: ["r.png", "g.png", "b.png", "-insert", "0"], pixels: [blue, red, green] },
        { args: ["r.png", "g.png", "b.png", "-insert", "1"], pixels: [red, blue, green] },
        { args: ["r.png", "g.png", "b.png", "-insert", "2"], pixels: [red, green, blue] },
        { args: ["r.png", "g.png", "b.png", "+insert"], pixels: [blue, red, green] },
        ...["-3", "-2", "3"].map(index => ({ args: ["r.png", "g.png", "b.png", "-insert", index], pixels: null })),
        { args: ["r.png", "g.png", "-insert", "-1"], pixels: null },
        { args: ["r.png", "g.png", "-insert", "1"], pixels: [red, green] },
        { args: ["r.png", "-insert", "0"], pixels: [red] },
        { args: ["r.png", "+insert"], pixels: [red] },
        ...["-1", "1"].map(index => ({ args: ["r.png", "-insert", index], pixels: null })),
        { args: ["r.png", "g.png", "b.png", "r.png", "-insert", "-2"], pixels: [red, red, green, blue] }
    ])(`inserts the last image into the remaining list in ${mode}: $args`, async ({ args, pixels }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const [index, name] of ["r.png", "g.png", "b.png"].entries()) {
            const bytes = await sharp(new Uint8Array([red, green, blue][index]!), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            files.set(name, bytes);
            await filesystem.writeFile(`/${name}`, bytes);
        }
        const command = [...args, "+append", "out.png"];
        const result = mode === "sync" ? runMagickCliSync(command, files)
            : await runMagickCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if (pixels === null) {
            expect(result.exitCode).not.toBe(0);
            if (mode === "retained") await expect(filesystem.readFile("/out.png")).rejects.toThrow();
            else expect(files.has("out.png")).toBe(false);
            return;
        }
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([pixels.length, 1]);
        expect([...output.data]).toEqual(pixels.flat());
    });
}
