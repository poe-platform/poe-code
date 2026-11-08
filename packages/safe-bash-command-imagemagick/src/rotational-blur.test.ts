import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMogrifyCli } from "./index.js";

for (const retained of [false, true])
for (const mogrify of [false, true])
it.each([0, 90])(`matches native asymmetric rotational blur at %s degrees (retained=${retained}, mogrify=${mogrify})`, async angle => {
    const pixels = Uint8Array.from({ length: 100 }, (_, i) => i % 4 === 3 || Math.floor(i / 4) === 2 ? 255 : 0);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = mogrify ? ["-rotational-blur", String(angle), "input.png"] : ["input.png", "-rotational-blur", String(angle), "out.png"];
    const result = await (mogrify ? runMogrifyCli : runConvertCli)(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const output = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect([output.width, output.height]).toEqual([5, 5]);
    expect(Array.from(output.data)).toEqual(angle === 0 ? Array.from(pixels) : [43, 64, 85, 64, 43, ...Array<number>(20).fill(0)].flatMap(value => [value, value, value, 255]));
});

for (const retained of [false, true])
it(`matches native rectangular color samples (retained=${retained})`, async () => {
    const pixels = Uint8Array.from({ length: 84 }, (_, i) => i % 4 === 3 || i === 12 || i === 82 ? 255 : 0);
    const input = await sharp(pixels, { raw: { width: 7, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file rotational blur I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await runConvertCli(["input.png", "-rotational-blur", "60", "out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect([output.width, output.height]).toEqual([7, 3]);
    const expected = Uint8Array.from({ length: 84 }, (_, i) => i % 4 === 3 ? 255 : 0);
    expected[8] = 51; expected[12] = 255; expected[16] = 51;
    expected[26] = 28; expected[54] = 85; expected[82] = 113;
    expect(output.data).toEqual(expected);
});
