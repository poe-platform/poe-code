import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-shear", "17x9"], ["-shear", "-13x7"], ["-shear", "0x0"],
    ["-swirl", "35"], ["-swirl", "-180"], ["-swirl", "0"],
    ["-implode", "0.7"], ["-implode", "-0.4"], ["-implode", "2"],
    ["-wave", "3x7"], ["-wave", "-3x7"], ["-wave", "0x0"],
    ...["15", "1.2,15", "3,4,15", "3,4,1.2,15", "3,4,1.2,0.7,15", "3,4,1.2,15,5,6", "3,4,1.2,0.7,15,5,6", ""].map(args => ["-distort", "SRT", args]),
    ["+distort", "Perspective", "0,0,1,2 12,0,11,1 0,16,2,15 12,16,12,16"],
    ["-distort", "PerspectiveProjection", "1,0.1,2,0.2,1,-1,0.01,0.02"],
    ["-distort", "PerspectiveProjection", "0,0,0,0,0,0,0,0"],
    ["-distort", "Affine", "0,0,1,2 12,0,11,1 0,16,2,15"],
    ["-distort", "Barrel", "0.1,0.2,-0.3"], ["-distort", "Barrel", "0.1,0.2,-0.3,1,4,5"],
    ["-distort", "Affine", "0,0 0,0"],
    ["-background", "#12345680", "-shear", "17x9"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
// Center-column grayscale values from ImageMagick 7: gradient:black-white -implode AMOUNT -depth 8 gray:-.
const implodeGradients = [
    { width: 9, height: 9, amount: 0.5, expected: [0, 29, 53, 77, 111, 176, 209, 234, 255] },
    { width: 9, height: 9, amount: -0.5, expected: [0, 35, 73, 109, 136, 151, 178, 214, 252] },
    { width: 9, height: 17, amount: 0.5, expected: [0, 15, 28, 41, 53, 65, 78, 93, 117, 153, 178, 193, 206, 218, 230, 242, 255] },
    { width: 9, height: 17, amount: -0.5, expected: [0, 17, 35, 54, 73, 92, 108, 122, 132, 139, 149, 163, 179, 198, 217, 236, 254] },
    { width: 17, height: 9, amount: 0.5, expected: [0, 28, 53, 76, 107, 179, 211, 234, 255] },
    { width: 17, height: 9, amount: -0.5, expected: [0, 35, 74, 109, 136, 150, 177, 213, 252] },
    { width: 9, height: 9, amount: 0, expected: [0, 32, 64, 96, 128, 159, 191, 223, 255] }
];
it.each(implodeGradients.flatMap(test => [false, true].map(retained => ({ ...test, retained }))))("implodes a $width x $height gradient: $amount, retained=$retained", async ({ width, height, amount, expected, retained }) => {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.round(Math.floor(i / (width * 4)) * 255 / (height - 1)));
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const files = new Map([["input", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    expect((await runConvertCli(["input", "-implode", String(amount), "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect([output.width, output.height]).toEqual([width, height]);
    // Allow 8-bit rounding differences from native's higher precision gradient.
    for (let y = 0; y < height; y++) expect(Math.abs(output.data[(y * width + Math.floor(width / 2)) * 4]! - expected[y]!)).toBeLessThanOrEqual(2);
    if (amount === 0) expect(output.data).toEqual(pixels);
    expect(output.data.slice(0, width * 4)).toEqual(pixels.slice(0, width * 4));
});
it("preserves original warp pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "f1b6a07fc858941e53b00fed5a2d533aecb55e8fc0276ee2804b0a67a05e1f7a",
        "864ec6413ffd61d2afe0ac70c57d4d0bf77813f9df82965e2d8eef82eb841d2d",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "2166198c6107ce294f2fc903f1f11a8f2113373fb829f2328b2b273f8b57dfea",
        "ebe6497ef81da10544340c4213d305280908f83d2da844ba0dca36019c205cb1",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "0da8d98726804dd2983e01f1d13d9a241d076d8584b9cf42ee89ebd8d83525b7",
        "1d46e8af64c14b7678e112c8fea204bbcb89cc2e676d0b6cc3360147d0521edb",
        "1c473ae0f725dbeaab8b1b59f403773840e71748bffcb3cfbbc6e6301ca3e38b",
        "d8bb47a3ca8ccbf9d1ed7e321c0122b95e5820e729fca276604e1bc5941f6029",
        "6e9deafd7cb9ca039991e246be0ffe7d7689c913604ef29f2436a0ef104edb20",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "c864411df8e23e3b25c90e240c91cb59c22ffacea1523755c28561cbd1f144f4",
        "9b0c450e25920a6670b6950577d2c39f08beee480da953392158d9f260141e6c",
        "8836e274c61117157d8f06ec3d5acab32706e5a9c2269b78f37129b51a2a7671",
        "b39df9666bf86a2a1950c2299eadc7a2ff443f846123036d81db6354b84b2cb2",
        "8c4c2afa36130848da9090cb19c2f7cb75a2e77ab2f8e7d71d408d1325b44569",
        "0617080a2762977c0f4493856ebac92d2654d2bbe9adc8a4ea119a9a71754084",
        "1188e8ae48b19854af7ca726b2955cb6f861d5de1181a94555f31d4e28d30f9b",
        "d8b795a786891f53dd97ee3ba923380b7bd5411efbf4bb56aeff099187437c94",
        "c22be252b7f857338c5dcfebe8d8d2e573c57cb5aa84f3bac83ba46c34c351e2",
        "44917239e95eee04052ca5008e23b1fa0e8ef4d41745fb74c1c2f4573a277379",
        "c8a41e5e5d306163275a2a936523d22747a3c746ddafec4582ffd81f72efddf0",
        "350b4b31de0933eb4fb46d3473bf7db07829f8a4dc2ac5b8fb0ed49b303bbe54",
        "a43e88b4c5ea08760b2f9efa9c6974dba360fbc5278d605655f9700b0e0d9a92",
        "002491ad2cc89fa294d9de433f0a626900ea91972d6bc2aa8eacf2215f423b7e",
        "d8b795a786891f53dd97ee3ba923380b7bd5411efbf4bb56aeff099187437c94",
        "f2f5e714b4087b2f588b30624e1674e63acd4de156773a2eb23423f3bc0167c0",
      ]
    `);
});
it.each([...operators, ...["edge", "background", "transparent", "black", "white", "gray", "tile", "mirror"].map(method => ["-virtual-pixel", method, "+distort", "SRT", "45"])].flatMap(args => (["-shear", "-swirl", "-wave"].includes(args[0]!) ? [[13, 17], [1031, 17], [1, 1]] : [[13, 17], [1, 1]]).map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file warp I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it.each([false, true])("rejects unknown distortion methods, retained=%s", async retained => {
    const bytes = await fixture(), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const result = await runConvertCli(["input", "-distort", "unknown", "1", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown");
    if (retained) await expect(fs.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
    else expect(files.has("out.png")).toBe(false);
});
