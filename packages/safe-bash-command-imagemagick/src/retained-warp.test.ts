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
    ...["15", "1.2,15", "3,4,15", "3,4,1.2,15", "3,4,1.2,0.7,15", "3,4,1.2,15,5,6", "3,4,1.2,0.7,15,5,6", "", "bad"].map(args => ["-distort", "SRT", args]),
    ["+distort", "Perspective", "0,0,1,2 12,0,11,1 0,16,2,15 12,16,12,16"],
    ["-distort", "PerspectiveProjection", "1,0.1,2,0.2,1,-1,0.01,0.02"],
    ["-distort", "PerspectiveProjection", "0,0,0,0,0,0,0,0"],
    ["-distort", "Affine", "0,0,1,2 12,0,11,1 0,16,2,15"],
    ["-distort", "Barrel", "0.1,0.2,-0.3"], ["-distort", "Barrel", "0.1,0.2,-0.3,1,4,5"],
    ["-distort", "unknown", "1"], ["-distort", "Affine", "0"],
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
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "56974305409f69dcf37b1cfb71680e2973a9d2e86c97aef20e727025aea9c030",
        "ec59bb212bcd77f726dcffe01605dcb3376381ac2b47f46a46eb1899ff34e0ec",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "99c653dd662b8c626d4a8e7805f131b0557aa341214b6c12013fe8b21ab28494",
        "d709039ae624768e3c4d527c76427b16f371b42a29ff53f32c67f1f39d1dda1e",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "a2438ed8af7f4af00ec3b693031bd1a759a05be10f9326fefa386b5c2e6445fb",
        "3e97302cac19fa0980690a60d3cd9a507e96f88e246e79b99ba4e3dec13246b5",
        "7ebd46e3abaf8ae1b04c5782c77704d7342b65641574184d852f716c0d5bfe1c",
        "b958c5233bb2ac64389fe3d47aab74438f9fff65b477369e02e793dc1cf7f675",
        "223871a9b691c254322c22473f53211879d912f52a3df4e60f76a6541dca66fc",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "807b4750796fed884682bf768aa9a2663cf91c996632014241d9304a5c4a0755",
        "5f566bb4894fe3b47171a603ff784ad7c6c97494f9e2c13f46365c45eaf6278a",
        "0741f21faf9c02c68bc335588df07466455fc2248ed31387f90a2e0b07300ad4",
        "1f0f7258957e43df202b7a84a4cc9749275995143fa7a6c919eebf798e92624c",
        "a5197ef5bbf0049d2b113cb56a6e71d1fbf5e7d278ca9f04677440c52f1b99ba",
        "87ec62817d2e7b3e4aac49ed74ec4c418a455ca75b63ed3901b37a69b23c14bb",
        "2a9dc881bca93b2fc40147b4642e697fca78f0f2abdff208993bbdcc26909bc2",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "c0239f6d04c352eba5cfc269ce48d47d032d378a2714021351ba4078ed2cb8e6",
        "d727355fd4065b4bfc499e3e10b9d93449714c3108a4e31e88031eaa83d15396",
        "74ea60d5b775e2f841ed5d7d5a76f98becce68f55ceee925213b4b02e151eb74",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "7e99bcd3e0359e8bc1e5415518605a07b9e962afd2bbd746e1b49485af33146d",
        "e9db4fb84f90e82f46e84e6bd99c0c13a9253679f83434db41bf52d9b4c655bc",
        "66892eba6bface414bbf31ff87948ba1844329bbc1e625720fd308ce9e280e32",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "b8e628a1d313e036dd1febb5b675c10a4624be6a2d9962fc25116f99d521e12e",
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
