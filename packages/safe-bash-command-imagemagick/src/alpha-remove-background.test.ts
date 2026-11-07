import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Decoded RGBA8 expectations verified against native ImageMagick.
const fixtures = [
    {
        name: "RGB transparency key",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAABnRSTlMADAAiADi4ncCAAAAABmJLR0QAWgB4AJbIbmOMAAAACW9GRnMAAAACAAAAAwC8z0QGAAAAEklEQVR4nGPgUbLgUbL8zwACAA1IAc3fKRb3AAAAAElFTkSuQmCC",
        removed: [90, 120, 150, 255, 12, 34, 57, 255, 255, 0, 0, 255, 0, 0, 0, 255],
        white: [255, 255, 255, 255, 12, 34, 57, 255, 255, 0, 0, 255, 0, 0, 0, 255],
        mask: [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    },
    {
        name: "indexed transparency",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEUAAP//AAD//wDYLcGjAAAAA3RSTlMAgP/s97MYAAAAAWJLR0QCZgt8ZAAAAAxJREFUeJxjYGBkAgAACAAENuCwpgAAAABJRU5ErkJggg==",
        removed: [255, 255, 0, 255, 255, 127, 0, 255, 255, 255, 0, 255],
        white: [255, 255, 255, 255, 255, 127, 127, 255, 255, 255, 0, 255],
        mask: [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255],
    },
];

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        it.each(["stored", "white", "extract", "later"] as const)(`${mode}: ${fixture.name} uses %s background when removing alpha`, async setting => {
            const input = Buffer.from(fixture.png, "base64");
            const files = new Map([["/in.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", ...(setting === "white" ? ["-background", "white"] : []), "-alpha", setting === "extract" ? "extract" : "remove", ...(setting === "later" ? ["-background", "white"] : []), "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            const expected = setting === "white" ? fixture.white : setting === "extract" ? fixture.mask : fixture.removed;
            expect([...output.data]).toEqual(expected);
        });
    }
}
