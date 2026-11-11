import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-convolve", "1"], ["-convolve", ""], ["-convolve", "bad,nan"],
    ["-convolve", "1,2,-1,0,3,0,-1,2,1"], ["-convolve", "2x2:0.5,-1,2,0.2"],
    ["-convolve", "0.1 0.2 0.3 0.4 0.5 0.6"],
    ["-edge", "1"], ["-canny", "2"], ["-emboss", "1"], ["-charcoal", "1"], ["-sketch", "1"]
];
async function fixture(width = 13) {
    return sharp(Uint8Array.from({ length: width * 17 * 4 }, (_, i) => i * 37 % 256), { raw: { width, height: 17, channels: 4 } }).png().toBuffer();
}
for (const retained of [false, true])
for (const operator of [["-convolve"], ["-morphology", "Convolve"]])
it.each([
    ["0,1,0,1,4,1,0,1,0", 255, 32, 128],
    ["0,-1,0,-1,-4,-1,0,-1,0", 255, 32, 128],
    ["0,-1,0,-1,4,-1,0,-1,0", 255, 0, 255]
] as const)(`matches ImageMagick impulse ${operator.join(" ")} (retained=${retained}): %s`, async (kernel, intensity, neighbor, center) => {
    // ImageMagick 7.1.2, opaque black RGBA 5x5 image with a grayscale impulse at (2, 2).
    const pixels = new Uint8Array(5 * 5 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.fill(intensity, 12 * 4, 12 * 4 + 3);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const spec = operator[0] === "-convolve" ? kernel : `3x3:${kernel}`;
    expect((await runConvertCli(["input.png", ...operator, spec, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    const expected = new Uint8Array(pixels.length);
    for (let i = 3; i < expected.length; i += 4) expected[i] = center === 255 || (operator[0] === "-morphology" && kernel.includes("-4")) ? 0 : 255;
    for (const index of [7, 11, 13, 17]) expected.fill(neighbor, index * 4, index * 4 + 3);
    expected.fill(center, 12 * 4, 12 * 4 + 3);
    expect(output.data).toEqual(expected);
});
it("preserves convolution pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "efb7ebcc125449f5a57f3e5ade22a07e0859fb58afbfa8654dca9b2b0cd41b28",
        "d9f0f157e2d496a288a3ebc6d75046bdba62192bc849d261f2b93acacfe4fbcd",
        "44e2592983af1eed2a60c92ce500a9ce8b1adbeb3477839cfba53149ebb8d5cc",
        "69e3e34050389f7b847a0a42b5c46ff5fb44ec18de01f69f88d8911a2bb13c8e",
        "8a5509dc3ef08cbe22fd02d870bbf7573900c990b5b0c5038626e800a7f024e8",
        "46b267e4109badeffc46f32a5acf2cb7f86a83f595dc75db5c541627b3ed6f3f",
        "7d5b2bdd5ebf3e48d56f40902ac1793f74348bc5b45fd8dea86c759a72c14c29",
        "f381c99cf7e4b7170cf6586facd82832a8abf866f871630b4a09555983b534c0",
        "1e103a8d9fb127ad50b4b1a9edf4e50a3df3b8358c16bf26a3bc0e9fd30b57f7",
      ]
    `);
});
for (const width of [13, 1031])
it.each(operators)(`retains width=${width} %s %s`, async (...args) => {
    const bytes = await fixture(width), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file convolution I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
