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
        "24b5b2e8bc2625a78ab930d81e9a2f2ec3025c18d677007f5faadca470372c71",
        "36406cbad971adb491a72cf6e8f44d6fc3b59eac1aefbf95a166cc98e8d356b5",
        "490c4c48b7330c1fd93b8c546368aabfc0432e08da0867deb62cafeafe53bbc3",
        "45533bb2a22df76201e6e359c1289573b0f90c87050178148cb38b28f3790c71",
        "68c9a7433c60975dd48966d58d8fd649bca3c34d56977646bc461d5ac34d752f",
        "cd6a89bbbcf269a8aefb9ec19345db56c9189716ed692d79ce0fc5c72dd0d4d2",
        "6d630306aa40b37dbc5d189efec4faa3fe7ca7a81c5b31757ba7d003c48b8f40",
        "be05a98f2bc80645c61a7308042681cae8fa0a1f44f7f21f7a753d6f9bc10f74",
        "8507c17e4e37e6ba8a260af9a75014e342dd130780e1f831ed2a8b58f2d9553e",
        "3ec22d86be723ba3afa131914e623a83347ad0ab641cfa8a9094116eda5ee3af",
        "c3aec38740b3ca7e23d677fb8add3824a6dfc9c8d277b1f7716449509d3d483b",
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
