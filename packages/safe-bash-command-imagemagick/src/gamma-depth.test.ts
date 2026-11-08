import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { gamma: "1", channel: "RGB", pixel: [0x4321, 0x8765, 0xabcd, 65535], expected: [0x4321, 0x8765, 0xabcd, 65535], output: "/out.png" },
        { gamma: "2", channel: "RGB", pixel: [0x4321, 0x8765, 0xabcd, 65535], expected: [0x8317, 0xba2c, 0xd1b7, 65535], output: "/out.png" },
        { gamma: "2", channel: "R", pixel: [16385, 24001, 40961, 32769], expected: [32769, 24001, 40961, 32769], output: "PNG64:/out.png" },
        { gamma: "2", channel: "A", pixel: [24001, 40961, 32769, 16385], expected: [24001, 40961, 32769, 32769], output: "/out.png" }
    ])("preserves native 16-bit gamma $gamma channel $channel via " + mode, async ({ gamma, channel, pixel, expected, output }) => {
        const data16 = Uint16Array.from(pixel);
        const input = encodeImage({ width: 1, height: 1, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        expect([...decodeImage(input).data16!]).toEqual(pixel);
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-channel", channel, "-gamma", gamma, "+channel", output];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const decoded = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(decoded.depth).toBe("ushort");
        expect(Array.from(decoded.data16 ?? [])).toEqual(expected);
    });
}
