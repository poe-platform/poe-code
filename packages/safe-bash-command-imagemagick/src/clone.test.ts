import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ...[
            { options: ["-clone", "1,"], tail: [green, red] },
            { options: ["-clone", "1,2,"], tail: [green, blue, red] },
            { options: ["-duplicate", "1,1,"], tail: [green, red] },
            { options: ["-clone", "1"], tail: [green] }
        ].map(({ options, tail }) => ({
            args: ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", ...options],
            pixels: [red, green, blue, [255, 255, 255, 255], ...tail]
        })),
        {
            args: ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", "-delete", "1,"],
            pixels: [red, blue, [255, 255, 255, 255]]
        },
        ...["1 2", "1\t2", "1\n2", " 1 , 2 ", "1, -1", "1-1 2"].flatMap(spec => [
            { args: ["r.png", "g.png", "b.png", "-clone", spec], pixels: [red, green, blue, green, blue] },
            { args: ["r.png", "g.png", "b.png", "-duplicate", `1,${spec}`], pixels: [red, green, blue, green, blue] },
            { args: ["r.png", "g.png", "b.png", "-delete", spec], pixels: [red] }
        ]),
        ...["1 x", "1 2x", "1 -", "1 1.5", "1 2-", ",1 2", " "].flatMap(spec => [
            { args: ["r.png", "g.png", "b.png", "-clone", spec], pixels: null },
            { args: ["r.png", "g.png", "b.png", "-duplicate", `1,${spec}`], pixels: null },
            { args: ["r.png", "g.png", "b.png", "-delete", spec], pixels: null }
        ]),
        { args: ["r.png", "g.png", "(", "b.png", "-clone", "0", ")"], pixels: [red, green, blue, red] },
        { args: ["r.png", "g.png", "(", "b.png", "+clone", ")"], pixels: [red, green, blue, green] },
        ...["0,8", "9", "-3", "0,-3"].flatMap(spec => [
            { args: ["r.png", "g.png", "-clone", spec], pixels: null },
            { args: ["r.png", "g.png", "-duplicate", `1,${spec}`], pixels: null }
        ]),
        { args: ["r.png", "g.png", "-clone", "0,0"], pixels: [red, green, red, red] },
        { args: ["r.png", "g.png", "-duplicate", "1,0,0"], pixels: [red, green, red, red] },
        { args: ["r.png", "g.png", "-clone", "0-3"], pixels: [red, green, red, green] },
        { args: ["r.png", "g.png", "-duplicate", "1,0-3"], pixels: [red, green, red, green] },
        ...["5-7", "3-0"].flatMap(spec => [
            { args: ["r.png", "g.png", "b.png", "-clone", spec], pixels: null },
            { args: ["r.png", "g.png", "b.png", "-duplicate", `1,${spec}`], pixels: null }
        ]),
        { args: ["r.png", "g.png", "b.png", "-clone", "0-5"], pixels: [red, green, blue, red, green, blue] },
        { args: ["r.png", "g.png", "b.png", "-duplicate", "1,0-5"], pixels: [red, green, blue, red, green, blue] },
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
