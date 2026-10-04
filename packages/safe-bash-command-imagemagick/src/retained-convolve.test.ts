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
it("preserves original convolution pixel vectors", async () => {
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
        "129c2abd350f3d85f0c669240b29bb6824a7ca2954ed4dd0987d2cc8bb0ce150",
        "7523590141d3fd3b14ad7c09f4dc461440a5c51250416ab05edb5b81e4a87f97",
        "d4094d53d3f49678ee0be3a7be313e9315716f6fdd27872e43e0f9e18b8b44d6",
        "0e4cbf0ead81e2f99a18d2ed821ad0e8d22a203905b2f540d64966aaecbe12a2",
        "0e4cbf0ead81e2f99a18d2ed821ad0e8d22a203905b2f540d64966aaecbe12a2",
        "1c986bbf5a236f9823a35c35600e35b0f56f0a4ce0186f98d65865a9c8753a95",
        "92119206879ae24b655884c183c54c96b493a495cf7e8874085f1bfb7170d2c4",
        "92119206879ae24b655884c183c54c96b493a495cf7e8874085f1bfb7170d2c4",
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
