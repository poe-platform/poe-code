import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-shadow", "80x3+5+5"], ["-shadow", "35x0.5-2+3"], ["-shadow", "0x1"], ["-shadow", "120x2"],
    ["-background", "#12345600", "-shadow", "80x1-3-2"],
    ["-vignette", "0x2"], ["-vignette", "ignored"], ["-background", "#12345680", "-vignette", "2x3"],
    ["-colorspace", "gray", "-background", "red", "-shadow", "80x1+1+1"],
    ["-colorspace", "gray", "-background", "red", "-vignette", "0x2"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original effect pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "fc4544b47f25671b8767763436c644329d8927de5ab40d48733679d4be536773",
        "9966743c2fe64c8af329ff2b2f4152bc79cf5e64dccf14553e6be62dfba381b6",
        "b96ebfb45b1f3a10dcda071b1415e8ede06715194aa307418683dfd37cf97c0d",
        "c0d0940c51c26a64a13e389ac79deee97c78fa7b2fe37f99223c629bead8c54d",
        "3c126d1da5eccd6b7e376bfe556008eb8e751eb4bb0d21519cac47880e7cc6e6",
        "64524215cd7a2e3c1ec0d50dc44bb98a9cd294f71406b7a9a80ea8d0b997e301",
        "64524215cd7a2e3c1ec0d50dc44bb98a9cd294f71406b7a9a80ea8d0b997e301",
        "09fbe3dcd7e32c9b895cf08002807e7b4f3b02687053a4b799f142ba0bbafd13",
        "bd034f8bc8f2e65d770238fb899388ba7fed572a692f1177d3a7a773b6e73b7a",
        "2041805a5242589be8dd943b1b3cad8159a1b89779372a7a9f61b03ff39c4881",
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
