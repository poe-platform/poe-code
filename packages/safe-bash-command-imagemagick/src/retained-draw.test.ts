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
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "460b132384b82e1920f3fd180a8122302b775362d559d80db2229d320d6f71a9",
        "884b94284151a79a484adc8b56eef76a7db3f3f13a7baa370cbe215dfe2366e4",
        "e9e1e34a42953f716dde968c37bb37e8a709624c142105850b096f99743de35c",
        "9de867e6ef72727443dbef5466bdfa20c28f5a47c7d583863ebe6ff0251b3d21",
        "be9e84ed596afb86382f22551411478288c6068edf392e21f987e3a0735189e4",
        "70a7de5fd273b869379ad99bca0eb44a1cd02597f9468540ee3deda5dab9154a",
        "7ead965957e274b82154760afa50355764e4da7864483434069cf0162753d80d",
        "dddd38ca2db5a5bf40a323a3053e9737070c9943f1339bfe66e8c5dd48d5de6d",
        "ee4e9e8d98ec1b19caef0b932653d7056be97f412834b7059d564676781fc77b",
        "e5e5e8a52e798d2792173725613c37fbfb3cbb01d6258ec6234b46429e9a9c42",
        "f311fad76126e7c3d4594bc4ac88dc8d9362d53a25692d1aae0c379a33d90a3a",
        "22bb7d1caae729a143368b99db13a1cd3f05ec377692d2cad99779d7c348591b",
        "d3b98c3d20a92e1f210c8fd9db66ed6be330b333920d38e38c3e1c05eb4c8156",
        "d3b98c3d20a92e1f210c8fd9db66ed6be330b333920d38e38c3e1c05eb4c8156",
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
