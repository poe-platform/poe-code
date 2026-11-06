import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["r.png", "g.png", "(", "b.png", "-clone", "0", ")"], pixels: [red, green, blue, red] },
        { args: ["r.png", "g.png", "(", "b.png", "+clone", ")"], pixels: [red, green, blue, green] },
        { args: ["r.png", "g.png", "-clone", "0"], pixels: [red, green, red] },
        { args: ["r.png", "g.png", "+clone"], pixels: [red, green, green] },
        { args: ["r.png", "(", "+clone", ")"], pixels: [red, red] },
        { args: ["r.png", "(", "g.png", "(", "b.png", "-clone", "0", ")", ")"], pixels: [red, green, blue, green] },
        { args: ["(", "r.png", "-clone", "0", ")"], pixels: null },
        { args: ["(", "r.png", "+clone", ")"], pixels: null }
    ])(`clones from the enclosing list in ${mode}: $args`, async ({ args, pixels }) => {
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
            return;
        }
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([pixels.length, 1]);
        expect([...output.data]).toEqual(pixels.flat());
    });
}
