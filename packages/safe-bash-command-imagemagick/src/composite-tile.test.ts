import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

for (const entry of ["map", "sync", "filesystem", "magick"] as const)
for (const tiled of [false, true])
it(`composite repeats the overlay across the base: ${entry}, tile=${tiled}`, async () => {
    const overlay = await sharp(new Uint8Array([255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
    const base = await sharp({ create: { width: 5, height: 4, channels: 3, background: "black" } }).png().toBuffer();
    const files = new Map([["overlay.png", overlay], ["base.png", base]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    const args = [...(tiled ? ["-tile"] : []), "overlay.png", "base.png", "out.png"];
    const result = entry === "sync" ? runCompositeCliSync(args, files)
        : entry === "magick" ? await runMagickCli(["composite", ...args], { filesystem: fs, cwd: "/" })
        : await runCompositeCli(args, entry === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const image = decodeImage(entry === "filesystem" || entry === "magick" ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect([image.width, image.height]).toEqual([5, 4]);
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255], [255, 255, 0, 255]];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
        expect([...image.data.subarray((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]).toEqual(tiled || (x < 2 && y < 2) ? colors[(y % 2) * 2 + x % 2] : [0, 0, 0, 255]);
    }
});

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("matches native tiled composite with transparency, compose and positioning settings", async () => {
    const overlay = await sharp(new Uint8Array([255, 0, 0, 128, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 255]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const base = await sharp({ create: { width: 5, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    for (const settings of [[], ["-compose", "multiply"], ["-gravity", "center", "-geometry", "+1+1"]]) {
        const result = spawnSync("magick", ["composite", "-tile", ...settings, ...[overlay, base].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
        expect(result.status).toBe(0);
        for (const retained of [false, true]) {
            const files = new Map([["overlay.png", overlay], ["base.png", base]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
            expect((await runCompositeCli(["-tile", ...settings, "overlay.png", "base.png", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
            const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
            const expected = decodeImage(result.stdout);
            expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
            expect(actual.data).toEqual(expected.data);
        }
    }
});
