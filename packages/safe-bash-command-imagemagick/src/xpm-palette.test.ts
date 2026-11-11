import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: many.png [ +dither ] app-icon.xpm,
// then app-icon.xpm -depth 8 rgba:-. Hash every decoded pixel, not just the header.
const references = [
    { alpha: true, colors: 207, options: [], hash: "20d8d1aed15c9b8986634c46a632f3f24abd86f9b1654078937632dcc37e7ed6" },
    { alpha: true, colors: 207, options: ["+dither"], hash: "dbb24bdcf41fac7e2f278c7986e552e1ac2e3f5d6f0f5fc11bec2f0c3c5e845d" },
    { alpha: false, colors: 221, options: ["-dither", "FloydSteinberg"], hash: "3922cc3d5cadd28cfc0d2eba0117ab5ec8d821c4fcc96175559ff5b6724b233c" },
    { alpha: false, colors: 221, options: [], hash: "0644d2b6a2626be4b1221dbeb78778a7ffb48d1ea0cbad841bad3a75935b5ac7" },
    { alpha: false, colors: 221, options: ["+dither"], hash: "8654994ec6827b8a4376ad5051a461262781ccad2f6a8a46834e9904109e2942" }
];
for (const mode of ["sync", "map", "filesystem"]) for (const write of [false, true]) for (const { alpha, colors, options, hash } of references) {
    it(`reduces XPM to the native palette (${mode}, write=${write}, alpha=${alpha}, ${options})`, async () => {
        const data = Uint8Array.from(Array.from({ length: 512 }, (_, i) => {
            const x = i % 32, y = Math.floor(i / 32);
            return [x * 8, y * 16, (x * 15 + y * 17) % 256, alpha && (x + y) % 11 === 0 ? 0 : 255];
        }).flat());
        const input = encodeImage({ width: 32, height: 16, data, format: "raw", space: "srgb", channels: alpha ? 4 : 3, depth: "uchar", density: 72, hasAlpha: alpha }, { format: "png", pngCoder: alpha ? "png32" : "png24" }).data;
        const files = new Map([["/many.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/many.png", input);
        const args = ["/many.png", ...options, ...(write ? ["-write", "XPM:/app-icon.bin", "/final.png"] : ["/app-icon.xpm"])];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const path = write ? "/app-icon.bin" : "/app-icon.xpm";
        const bytes = mode === "filesystem" ? await filesystem.readFile(path) : files.get(path)!;
        expect(new TextDecoder().decode(bytes).split("\n")[3]).toBe(`"32 16 ${colors} 2 ",`);
        const pixels = decodeImage(bytes).data;
        expect([...pixels.slice(0, 4)]).toEqual(alpha ? [0, 0, 0, 0] : [4, 0, 8, 255]);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
        if (write) {
            const final = mode === "filesystem" ? await filesystem.readFile("/final.png") : files.get("/final.png")!;
            expect(decodeImage(final).data).toEqual(data);
        }
    });
}
