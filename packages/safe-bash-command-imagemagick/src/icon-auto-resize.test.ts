import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const cases = [
    { name: "minimum and neighboring sizes", options: ["-define", "icon:auto-resize=16,17"], sizes: [16, 17] },
    { name: "requested sizes", options: ["-define", "icon:auto-resize=64,32,16"], sizes: [64, 32, 16] },
    { name: "requested order", options: ["-define", "icon:auto-resize=16,64,32"], sizes: [16, 64, 32] },
    { name: "first input", options: ["xc:red", "-define", "icon:auto-resize=32,16"], sizes: [32, 16] },
    { name: "default sizes", options: ["-define", "icon:auto-resize"], sizes: [256, 192, 128, 96, 64, 48, 40, 32, 24, 16] },
    { name: "removed define", options: ["-define", "icon:auto-resize=32,16", "+define", "icon:auto-resize"], sizes: [64] },
    { name: "write snapshot", options: ["-define", "icon:auto-resize=32,16", "-write", "out.ico", "+define", "icon:auto-resize"], sizes: [32, 16], output: "null:" },
];
it.each(["sync", "buffered", "retained"] as const)("writes requested ICO sizes from one source (%s)", async mode => {
  for (const test of cases) {
    const data = new Uint8Array(64 * 64 * 4);
    for (let p = 0; p < data.length; p += 4) { data[p + 2] = 255; data[p + 3] = 255; }
    data[3] = 0;
    const source = encodeImage({ width: 64, height: 64, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const files = new Map([["input.png", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const args = ["input.png", ...test.options, test.output ?? "out.ico"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "retained" ? await fs.readFile("/out.ico") : files.get("out.ico")!;
    expect([...bytes.slice(0, 6)]).toEqual([0, 0, 1, 0, test.sizes.length, 0]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const [index, size] of test.sizes.entries()) {
        const entry = 6 + index * 16;
        expect([...bytes.slice(entry, entry + 2)]).toEqual([size % 256, size % 256]);
        const length = view.getUint32(entry + 8, true), offset = view.getUint32(entry + 12, true);
        expect(offset + length).toBeLessThanOrEqual(bytes.length);
        const image = decodeImage(bytes, { page: index });
        expect([image.width, image.height]).toEqual([size, size]);
        if (size === 64) expect(image.data[3]).toBe(0);
        expect([...image.data.slice((size * Math.floor(size / 2) + Math.floor(size / 2)) * 4).slice(0, 4)]).toEqual([0, 0, 255, 255]);
    }
  }
});

it.each(["sync", "buffered", "retained"] as const)("rejects out-of-range icon lists without creating or replacing the destination (%s)", async mode => {
    for (const sizes of ["1", "2", "3", "8", "15", "16,15", "15,16", "257"]) {
        for (const original of [undefined, Uint8Array.of(1, 2, 3)]) {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            if (original) { files.set("out.ico", original); await fs.writeFile("/out.ico", original); }
            const args = ["-size", "32x32", "gradient:red-blue", "-define", `icon:auto-resize=${sizes}`, "out.ico"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode, sizes).toBe(1);
            expect(result.stderr).toContain("icon:auto-resize");
            if (mode === "retained") {
                if (original) expect(await fs.readFile("/out.ico")).toEqual(original);
                else await expect(fs.readFile("/out.ico")).rejects.toMatchObject({ code: "ENOENT" });
            } else expect(files.get("out.ico")).toEqual(original);
        }
    }
});

it.each(["sync", "buffered", "retained"] as const)("preserves ordinary small ICO dimensions without auto-resize (%s)", async mode => {
    const source = new TextEncoder().encode("P3\n4 2\n255\n" + "255 0 0\n".repeat(8));
    const files = new Map([["input.ppm", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.ppm", source);
    const args = ["input.ppm", "out.ico"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "retained" ? await fs.readFile("/out.ico") : files.get("out.ico")!;
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([4, 2]);
});
