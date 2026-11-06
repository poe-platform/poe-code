import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["r.png", "g.png", "-swap", "0.5,1"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "bad,1"], pixels: null },
        { args: ["r.png", "g.png", "b.png", "-swap", "0,9"], pixels: null },
        { args: ["r.png", "+swap"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "0,0"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "0,-2"], pixels: null },
        { args: ["r.png", "g.png", "-swap", "-3,0"], pixels: null },
        { args: ["r.png", "g.png", "b.png", "-swap", "0,2"], pixels: [blue, green, red] },
        { args: ["r.png", "g.png", "b.png", "-swap", "-1,0"], pixels: [blue, green, red] },
        { args: ["r.png", "g.png", "b.png", "+swap"], pixels: [red, blue, green] }
    ])(`validates image swaps in ${mode}: $args`, async ({ args, pixels }) => {
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
