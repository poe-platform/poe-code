import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-fill", "red", "-floodfill", "+0+0"],
    ["-fill", "#12345680", "-floodfill", "+4+4"],
    ["-fill", "none", "-fuzz", "100%", "-floodfill", "+0+0"],
    ["-fill", "blue", "-fuzz", "20%", "-floodfill", "4x7"],
    ["-fill", "green", "-floodfill", "+999+999"],
    ["-fill", "blue", "-floodfill", "+0+0", "red"],
    ["-fill", "blue", "-floodfill", "+0+0", "#000000"],
    ["-fill", "#10203040", "-fuzz", "100%", "-floodfill", "+5+7", "white"]
];
async function fixture(width = 53, height = 37) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => Math.floor(i / 4) % width < width / 2 ? (i % 4 === 3 ? 255 : 0) : (i % 4 === 3 ? 128 : 200)), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it.each(["buffered", "retained"].flatMap(mode => ["color", "alpha"].map(primitive => ({ mode, primitive }))))("draw $primitive floodfill preserves enclosed white detail ($mode)", async ({ mode, primitive }) => {
    const pixels = new Uint8Array(7 * 7 * 4).fill(255);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) {
        if (x === 3 && y === 3) continue;
        pixels.fill(0, (y * 7 + x) * 4, (y * 7 + x) * 4 + 3);
    }
    const bytes = await sharp(pixels, { raw: { width: 7, height: 7, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const result = await runConvertCli(["input.png", "-alpha", "set", "-fill", "none", "-draw", `${primitive} 0,0 floodfill`, "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const offset = (y * 7 + x) * 4;
        if (primitive === "alpha") expect(image.data.slice(offset, offset + 3)).toEqual(pixels.slice(offset, offset + 3));
        if (x < 2 || x > 4 || y < 2 || y > 4) expect(image.data[offset + 3]).toBe(0);
        else expect(image.data.slice(offset, offset + 4)).toEqual(pixels.slice(offset, offset + 4));
    }
});
it.each(["buffered", "retained"])("draw floodfill follows earlier vector strokes and inline fill (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const result = await runConvertCli(["-size", "7x7", "xc:white", "-fill", "blue", "-draw", "fill none stroke black stroke-width 1 rectangle 1,1 5,5 fill red color 0,0 floodfill", "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
    expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...image.data.slice((3 * 7 + 3) * 4, (3 * 7 + 3) * 4 + 4)]).toEqual([255, 255, 255, 255]);
});
it.each(["buffered", "retained"].flatMap(mode => [
    { draw: "matte 0,0 floodfill", primitive: "matte" },
    { draw: "not-a-primitive 0,0", primitive: "not-a-primitive" },
    { draw: "rectangle 1,1 5,5 matte 0,0 floodfill", primitive: "matte" }
].map(test => ({ mode, ...test }))))("rejects unsupported drawing without replacing output ($mode, $draw)", async ({ mode, draw, primitive }) => {
    const original = new TextEncoder().encode("existing output");
    const files = new Map([["out.png", original]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.png", original);
    const result = await runConvertCli(["-size", "7x7", "xc:white", "-alpha", "on", "-fill", "none", "-draw", draw, "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Unsupported drawing primitive: ${primitive}`);
    expect(mode === "buffered" ? files.get("out.png") : await fs.readFile("/out.png")).toEqual(original);
});
it("preserves original floodfill pixel vectors", async () => {
    const bytes = await fixture();
    const fills = [
        { side: "left", color: [255, 0, 0, 255] },
        { side: "left", color: [18, 52, 86, 128] },
        { side: "all", color: [0, 0, 0, 0] },
        { side: "left", color: [0, 0, 255, 255] },
        undefined,
        undefined,
        { side: "left", color: [0, 0, 255, 255] },
        { side: "all", color: [16, 32, 48, 64] }
    ];
    for (const [index, args] of operators.entries()) {
        const files = new Map([["input", bytes]]), expected = decodeImage(bytes).data.slice();
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        const fill = fills[index];
        if (fill) for (let pixel = 0; pixel < 53 * 37; pixel++) {
            if (fill.side === "all" || (pixel % 53 < 53 / 2 ? "left" : "right") === fill.side)
                expected.set(fill.color, pixel * 4);
        }
        expect(decodeImage(files.get("out.png")!).data).toEqual(expected);
    }
});
it.each(operators.flatMap(args => [[53, 37], [1031, 31], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file floodfill I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
it("preserves disconnected regions and ignores alpha when matching across cached pages", async () => {
    const width = 257, height = 129, pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const barrier = ((x === 5 || x === width - 6) && y >= 5 && y <= height - 6) || ((y === 5 || y === height - 6) && x >= 5 && x <= width - 6);
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = barrier ? 255 : 0;
        pixels[offset + 3] = (x + y) % 256;
    }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file floodfill I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await runConvertCli(["input", "-fill", "red", "-floodfill", "+6+6", "out.png"], { filesystem, cwd: "/" })).exitCode).toBe(0);
    const actual = decodeImage(await fs.readFile("/out.png"));
    for (let y = 6; y < height - 6; y++) for (let x = 6; x < width - 6; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 255; pixels[offset + 3] = 255;
    }
    expect(actual.data).toEqual(pixels);
});

it.each(["buffered", "retained"].flatMap(mode => [
    { fuzz: "0%", pixels: [100,100,100,255, 101,100,100,255, 100,100,100,255], alpha: [64,255,255] },
    { fuzz: "5%", pixels: [100,100,100,255, 130,100,100,255, 140,100,100,255], alpha: [64,64,255] },
    { fuzz: "0%", pixels: [100,100,100,255, 100,100,100,128, 100,100,100,255], alpha: [64,128,255] },
    { fuzz: "36%", pixels: [100,100,100,255, 100,100,100,128, 100,100,100,255], alpha: [64,64,64] },
    { fuzz: "0%", pixels: [0,0,0,0, 255,255,255,0, 100,100,100,255], alpha: [64,64,255] },
    { fuzz: "2%", pixels: [100,100,100,128, 120,100,100,128, 140,100,100,128], alpha: [64,64,128] },
    { fuzz: "32768", pixels: [100,100,100,255, 100,100,100,128, 100,100,100,255], alpha: [64,64,64] }
].map(test => ({ mode, ...test }))))("matches native alpha floodfill vectors ($mode, $fuzz, $pixels)", async ({ mode, fuzz, pixels, alpha }) => {
    const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const result = await runConvertCli(["input.png", "-fuzz", fuzz, "-fill", "#abcdef40", "-draw", "alpha 0,0 floodfill", "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
    expect([...image.data]).toEqual(pixels.map((value, i) => i % 4 === 3 ? alpha[Math.floor(i / 4)] : value));
});

it.each(["buffered", "retained"])("alpha floodfill uses four-connected pixels and exact matching by default (%s)", async mode => {
    const pixels = Uint8Array.from([255,255,255,255, 254,255,255,255, 0,0,0,255, 255,255,255,255]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const result = await runConvertCli(["input.png", "-fill", "none", "-draw", "alpha 0,0 floodfill", "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
    pixels[3] = 0;
    expect(image.data).toEqual(pixels);
});
