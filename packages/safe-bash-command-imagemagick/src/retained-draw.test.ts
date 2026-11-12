import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-draw", "rectangle 1,2 11,12"], ["-fill", "#12345680", "-draw", "rectangle -3,-2 14,15 circle 5,7 11,12"],
    ["-fill", "#12345680", "-draw", "circle 5,7 11,12"],
    ["-stroke", "blue", "-strokewidth", "2", "-draw", "rectangle 1,2 11,12 circle 5,7 11,12"],
    ["-draw", "point 3,4 rectangle 1,2 11,12 circle 5,7 11,12"],
    ["-draw", "roundRectangle 1,2 11,12 2,3 ellipse 5,7 3,4 0,360"],
    ["-draw", "line 1,2 11,12 text 2,13 'Hello gj'"],
    ["-draw", "polygon 1,2 11,2 7,14 polyline 2,3 8,10 2,13"],
    ["-draw", "bezier 1,2 5,7 11,12 bezier 1,2 5,7 8,6 11,12"],
    ["-draw", "path 'M 1 2 L 11 12 L 2 14 Z'"],
    ["-draw", "fill none stroke red stroke-width 2 rectangle 1,2 11,12"],
    ["-density", "144", "-draw", "rectangle 1,2 11,12 point 3,4 circle 5,7 11,12"],
    ["-draw", "fill none rectangle 1,2 11,12"], ["-draw", ""]
];
async function fixture(width = 53, height = 37) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original drawing pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "c5f6d7c23bf4832d499b5a11249a794947ba7de1a730858040176d9a5b69f743",
        "87fba2cc9380d9906ca12cfd919ca0ed6e2cc474497e496f3652ec2513bbe40a",
        "52f8f994c694bae4938847963818bd9f3bdc30cd3b69793fe5daae2c29f147b6",
        "490c4c48b7330c1fd93b8c546368aabfc0432e08da0867deb62cafeafe53bbc3",
        "1e5b865e684300d379cef949e63e5dae75bbe6688f518751d856bed19125c60a",
        "b5bdd3735561125055bc40fa828e531f8425864e62c8c1a77ab59f765c6c04de",
        "c5c9cd3ddfbefc6b1f4ea3a969ee0972c06d9652f7eb9ba7ad351690440801da",
        "fc0c18793a56602c3e5ccea187be9fbaa160ddbeec71ecd307712a0d5c0bf766",
        "70e8bd6e5ef5364bfd6fe1fc55a946845c2aebb92e841c1ea0a16f3b8953d3cc",
        "343d1ed9e0415ac74e67190d816e4a7d10f8e29109bf4bd1fc276cfe74de8664",
        "b5210ff1f4454bbd02f921771e4d5ee9781a65fdee83bc02494c8449001c9575",
        "1e5b865e684300d379cef949e63e5dae75bbe6688f518751d856bed19125c60a",
        "c2707ad5db8627c7b7cdf416f033116ea80e69e388ea69e420c17142c6371e09",
        "c2707ad5db8627c7b7cdf416f033116ea80e69e388ea69e420c17142c6371e09",
      ]
    `);
});
it.each(operators.flatMap(args => [[53, 37], [1031, 31], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file drawing I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
