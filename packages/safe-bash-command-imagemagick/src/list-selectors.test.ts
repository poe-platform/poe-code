import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ...["1x2", "bad", "0,bad", "1-2x", "0,1,bad"].flatMap(spec => [
            { args: ["r.png", "g.png", "-clone", spec], pixels: null },
            { args: ["r.png", "g.png", "-delete", spec], pixels: null },
            { args: ["r.png", "g.png", "-duplicate", `1,${spec}`], pixels: null }
        ]),
        ...["invalid", "0,foo"].map(spec => ({ args: ["r.png", "g.png", "-swap", spec], pixels: null })),
        ...["0,foo"].map(spec => ({ args: ["r.png", "g.png", "-duplicate", spec], pixels: null })),
        { args: ["r.png", "g.png", "b.png", "-clone", "-1--2,0"], pixels: [red, green, blue, blue, green, red] },
        { args: ["r.png", "g.png", "b.png", "-delete", "-1,0"], pixels: [green] },
        { args: ["r.png", "g.png", "-clone", "0,,1,"], pixels: [red, green, red, green, red] },
        { args: ["r.png", "g.png", "-delete", "99"], pixels: [red, green] },
        { args: ["r.png", "g.png", "-swap", "-1,0"], pixels: [green, red] },
        { args: ["r.png", "g.png", "-duplicate", "1,-1-0"], pixels: [red, green, green, red] }
    ])(`validates list selectors in ${mode}: $args`, async ({ args, pixels }) => {
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
