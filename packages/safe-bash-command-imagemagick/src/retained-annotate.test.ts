import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-annotate", "Hello gjpqy,;!"], ["-annotate", "+3+4", "Hello"],
    ["-fill", "#12345680", "-gravity", "center", "-annotate", "-2-3", "Ab gy"],
    ["-density", "144", "-pointsize", "9", "-annotate", "+0+0", "?😀"],
    ["-density", "83", "-pointsize", "17", "-gravity", "southeast", "-annotate", "+1-3", "xy"],
    ["-fill", "none", "-annotate", "invisible"], ["-annotate", ""],
    ["-pointsize", "3", "-annotate", "0x0+2+1", "i j"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original annotation pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "a5b2c31b05a65207aac361f732cf2e0f79960cc37c78a5edca2e30786cc87afa",
        "c998318230304e92b40151c50b787bdb9f960a8ec9f3c7dd6cff37966c00cf35",
        "80b3353664ec5027345884665af0d81486a367ee9634eaac964bec42fbf4858b",
        "eab895dab1902cf012c088b4455008e9325497c079ac1b3d2a5578378294598c",
        "3524d65c96c6a6f8d6ba75d9cfe060cab4323da83760e23ca11dede448f9125a",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "4d6958a5b1856d33e4958be64c75a55533aa73309a938ce487f25731abc3899b",
        "95b465989ef20e01b731de291af66e4cfd6ce9f9f20b992ddd35cf6ac5ed32b4",
      ]
    `);
});
it.each(operators.flatMap(args => [[53, 37], [1031, 31], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file annotation I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
