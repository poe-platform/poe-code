import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
for (const operator of ["-blur", "-gaussian-blur"])
it.each([
    ["RGB", [true, true, true, false]],
    ["R", [true, false, false, false]],
    ["A", [false, false, false, true]],
    ["RGBA", [true, true, true, true]]
] as const)(`${operator} honors %s channels (retained=${retained})`, async (channels, mask) => {
    const pixels = [255, 0, 0, 255, 0, 255, 0, 160, 0, 0, 255, 35];
    const input = await sharp(Uint8Array.from(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const run = async (options: string[]) => {
        expect((await runConvertCli(["input.png", ...options, operator, "0x1", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
        return Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data);
    };
    const defaults = await run([]);
    expect(defaults.filter((_, i) => i % 4 === 3)).not.toEqual([255, 160, 35]);
    expect(await run(["-channel", channels])).toEqual(defaults.map((value, i) => mask[i % 4] ? value : pixels[i]));
    expect(await run(["-channel", channels, "+channel"])).toEqual(defaults);
});
