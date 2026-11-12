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
        "0e44e7d7d1ea5ef507dcebf396cfdcbe61ff5ba3c9895813768d4a86a338ea74",
        "f14cb946031aae80a6a00e39d6e3717434f84fbe98b341f35672c677a8e5d48a",
        "308fb3ac519b4ccd172e95fa6e29dd23f41a3a5d8d9a272d2eeb2ba4cbae806f",
        "09a0ad1b855cd705811bc36d5d53b7a66d2dd0b7c496b11e282ab5a634c0f25a",
        "5aac6120a757f2f67d61ba297db71329d99e38212cd0439a8e93e2bee3cd8ac0",
        "0e44e7d7d1ea5ef507dcebf396cfdcbe61ff5ba3c9895813768d4a86a338ea74",
        "0e44e7d7d1ea5ef507dcebf396cfdcbe61ff5ba3c9895813768d4a86a338ea74",
        "d92482746105d247d92fbb762c287a8af2f2c3ca2ddfb36b53047d5bbd9991f8",
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
