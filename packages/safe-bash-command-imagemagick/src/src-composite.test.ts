import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runConvertCli, runConvertCliSync } from "./index.js";

const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255], [255, 255, 0, 255]];
const native = spawnSync("magick", ["-version"]);
for (const command of ["composite", "convert"] as const)
for (const entry of ["sync", "buffered", "retained"] as const)
for (const mode of ["Src", "Over"])
for (const offset of [0, 1, -1])
it(`${command} ${entry} ${mode} extends source edges at offset ${offset}`, async () => {
    const overlay = sharp(new Uint8Array(colors.flat()), { raw: { width: 2, height: 2, channels: 4 } }).png().toBufferSync();
    const base = sharp({ create: { width: 3, height: 3, channels: 3, background: "black" } }).png().toBufferSync();
    const files = new Map([["/overlay.png", overlay], ["/base.png", base]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const settings = ["-compose", mode, "-geometry", offset < 0 ? "-1-1" : `+${offset}+${offset}`];
    const args = command === "composite" ? [...settings, "/overlay.png", "/base.png", "/out.png"]
        : ["/base.png", "/overlay.png", ...settings, "-composite", "/out.png"];
    const result = entry === "sync" ? (command === "composite" ? runCompositeCliSync : runConvertCliSync)(args, files)
        : await (command === "composite" ? runCompositeCli : runConvertCli)(args, entry === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const actual = decodeImage(entry === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    const expected = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const sx = x - offset, sy = y - offset;
        expected.push(...(mode === "Src" || (sx >= 0 && sx < 2 && sy >= 0 && sy < 2)
            ? colors[Math.max(0, Math.min(1, sy)) * 2 + Math.max(0, Math.min(1, sx))]!
            : [0, 0, 0, 255]));
    }
    expect([actual.width, actual.height]).toEqual([3, 3]);
    expect([...actual.data]).toEqual(expected);
    if (!native.error) {
        const nativeArgs = args.map(arg => files.has(arg) && arg !== "/out.png" ? `inline:data:image/png;base64,${Buffer.from(files.get(arg)!).toString("base64")}` : arg === "/out.png" ? "png:-" : arg);
        const reference = spawnSync("magick", command === "composite" ? ["composite", ...nativeArgs] : nativeArgs);
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const image = decodeImage(reference.stdout);
        expect([actual.width, actual.height]).toEqual([image.width, image.height]);
        expect(actual.data).toEqual(image.data);
    }
});
