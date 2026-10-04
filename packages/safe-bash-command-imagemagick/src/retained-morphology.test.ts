import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ...["erode", "minimum", "dilate", "maximum", "open", "close", "edgein", "edgeout", "edge", "gradient", "tophat", "bottomhat", "median", "unknown"].map(method => ["-morphology", method, "3x5"]),
    ["-morphology", "median", "Square:2"], ["-morphology", "median", ""],
    ["-morphology", "Convolve", "1,2,-1,0,3,0,-1,2,1"], ["-morphology", "Correlate", "2x2:0.5,-1,2,0.2"],
    ["-statistic", "median", "5x3"], ["-statistic", "minimum", "3x3"], ["-statistic", "maximum", "1x1"], ["-statistic", "mean", "3x3"]
];
async function fixture(width = 13) {
    return sharp(Uint8Array.from({ length: width * 17 * 4 }, (_, i) => i * 37 % 256), { raw: { width, height: 17, channels: 4 } }).png().toBuffer();
}
it("preserves original morphology pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "b447dca94d626943c72acedbcb8fbe8e7d6d650088465564e4678b6bbcb70893",
        "b447dca94d626943c72acedbcb8fbe8e7d6d650088465564e4678b6bbcb70893",
        "5c97f08bd90d5aa6cdd5d4cbd206be407e8d41a882f604db2433b6c2a7a398aa",
        "5c97f08bd90d5aa6cdd5d4cbd206be407e8d41a882f604db2433b6c2a7a398aa",
        "813ac25843e8d57c8794e888aa2983a9313e6adf4334a00c34d132d13b163ec9",
        "eb79239052f98f55fdc9c9a4f760e5b801639fd4a325f7d9cbb02bdeb4b36f3e",
        "05edc68587f718c854d14d38e54e08df6b77536ded62dd9bca051d8e464d04c5",
        "3170c3cca84d69aa54fa8fb76d2a804c2d70f7fb05455fecb8fc8eb3cb77a430",
        "b823cf9c108029b1059571d63496a26302a64a2aeec889b8ebc53d011eabb769",
        "b823cf9c108029b1059571d63496a26302a64a2aeec889b8ebc53d011eabb769",
        "c025507f95c5f736671db65c1b87d655f0f850171c414e7444d7dd501d840992",
        "7d47aee12529a8327466284023823121b3cefc359c2d820445760713adaacbea",
        "660d2ace02b838a136de3d575f4a80037c819db33f876f00b3d82079d84a402e",
        "5c97f08bd90d5aa6cdd5d4cbd206be407e8d41a882f604db2433b6c2a7a398aa",
        "238307eb2f8ffb95415581d796f95c37296756e075f44210da0c936e7ac7f1b3",
        "c3c1d1ec79853dc2ded937f636c21d74f8e04a5d4a55c647695a61f87cd5bacc",
        "129c2abd350f3d85f0c669240b29bb6824a7ca2954ed4dd0987d2cc8bb0ce150",
        "7523590141d3fd3b14ad7c09f4dc461440a5c51250416ab05edb5b81e4a87f97",
        "603a6aa8e4cefa823a0f315557fc47fe0206348e386271a03bf304850def1c35",
        "4f444da8e253d27f00c0b9eecef35b86fc4de2bdc7c21f6c10d4a7c449ad6e1e",
        "83e7e62459e7f7c8f9e118eebf6f055725a8c69cf5e23ebe03115a83cc569d4e",
        "83e7e62459e7f7c8f9e118eebf6f055725a8c69cf5e23ebe03115a83cc569d4e",
      ]
    `);
});
it.each(operators.flatMap(args => (["median", "open"].includes(args[1]!) ? [13, 2053] : [13]).map(width => ({ width, args }))))("retains width=$width $args", async ({ width, args }) => {
    const bytes = await fixture(width), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file morphology I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
