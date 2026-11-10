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
        "ec7829064f8da6eb8f66ed14a91cd3cdc8695caa242db868e2bc5a8ebdc0bc1b",
        "5f6f2512e55fef99b714f7b1be6cf94592a2d2f2ab3e56dc68cb6dbd049823be",
        "cd48d5bb3291380b0ec1c9fb80dc4a1aaa43f1b94d008fa9fd6e89a85118bcf0",
        "fe5729d3e981825613e73a81f85aeb8fc81930fce1b729a5118264f277d49bc2",
        "321fbaf28b89a2a46263211f973ee8c1a40349ccd6e525928d2f7f430126a580",
        "0e44e7d7d1ea5ef507dcebf396cfdcbe61ff5ba3c9895813768d4a86a338ea74",
        "0e44e7d7d1ea5ef507dcebf396cfdcbe61ff5ba3c9895813768d4a86a338ea74",
        "f8a50a90a836acc99c9612fab5081ff364ecc1e1ef6a8e9ce143ee9a008d7677",
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
