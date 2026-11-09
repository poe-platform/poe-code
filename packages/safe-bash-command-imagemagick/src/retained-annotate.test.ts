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
it("preserves annotation pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "61fdff99ba19c32afe342548e5159e08cec0809f9731aaff551be5c73ec18634",
        "999b88d404a67431baf04e63dc9b7651be5d7e5e5a3a2b971e88222410c85cf5",
        "1b852e8d38d9aca8c256e8cd47632d2765a7f0cd954bf2528fbe49b38b4e307e",
        "565f97a6162e9c334e4d1672327411cf49848d8bc3610a7f1cffa1df1a185f1e",
        "dcac5e44c0f72435ad4640de876d4f94176e6cee699481531abe59ad8cc750fd",
        "f30389287fc914a5019dbe63002ecd6ed8f2503cdd71c32f40c97161d896c3e4",
        "f30389287fc914a5019dbe63002ecd6ed8f2503cdd71c32f40c97161d896c3e4",
        "faa2650ebcb77777be137d98a42bcf2a4852bd19e5a7dff61ff8b461353bde6f",
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
