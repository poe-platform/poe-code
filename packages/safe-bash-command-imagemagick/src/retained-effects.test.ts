import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-shadow", "80x3+5+5"], ["-shadow", "35x0.5-2+3"], ["-shadow", "0x1"], ["-shadow", "120x2"],
    ["-background", "#12345600", "-shadow", "80x1-3-2"],
    ["-vignette", "0x2"], ["-vignette", "0x1"], ["-background", "#12345680", "-vignette", "2x3"],
    ["-colorspace", "gray", "-background", "red", "-shadow", "80x1+1+1"],
    ["-colorspace", "gray", "-background", "red", "-vignette", "0x2"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves effect pixels and geometry", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        const image = decodeImage(files.get("out.png")!);
        hashes.push(createHash("sha256").update(image.data).update(JSON.stringify([image.width, image.height, image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 }])).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "d9e3846429aa72bb26c2d2ca64126e97ae7aff5fbc9373d7982d6e8ffa01a90f",
        "88210fe67f2017aed944c49ffc49864bb909dfaa52d17435f8e1f7498e92b347",
        "0aeec4fe0cb8c49a1547bd5a88788e51a2a62b0abf81e2a7cef88e40bcb8c1ff",
        "c0b18fbea25c054d748f52a5a4ce674d8ae37162e98adbaa38c895ae7c1b8d8c",
        "f1ea0fe184d9a8ab52a56ea374b8feb30c05a1f632b7108e3d7eec13121ee748",
        "1620ee98360a99e5374e2d9e8d5f22836605b4b3332f80df70357a8f0557724d",
        "93a5072ee91515fe8062ef60899bbe86c8b59c70eb4010219b3af315198931ec",
        "196f0b863a5f1f73ef837ea6d156ff75e5c75841d88e3656ae69c6b22644bc33",
        "78f12fb9287470af4868271ebb1f872753d0f410c938d4fca9f65db2b4c0d378",
        "4a5f8c80ad4ec2be3ceb1a70ce9e05716f14727b1f565ce0e8e537160f7bc0da",
      ]
    `);
});
it.each(operators.flatMap(args => [[13, 17], [1031, 3], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file effect I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
