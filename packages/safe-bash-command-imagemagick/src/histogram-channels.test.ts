import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2 Q16: selected channels determine both the bars and their scale.
for (const retained of [false, true]) for (const format of ["png", "miff"]) {
    it.each([
        { channels: ["-channel", "red"], low: [200, 0, 0], high: [200, 0, 0] },
        { channels: ["-channel", "green"], low: [0, 200, 0], high: [0, 67, 0] },
        { channels: ["-channel", "blue"], low: [0, 0, 200], high: [0, 0, 29] },
        { channels: ["-channel", "RG"], low: [133, 200, 0], high: [133, 67, 0] },
        { channels: ["-channel", "alpha"], low: [0, 0, 0], high: [0, 0, 0] },
        { channels: ["-channel", "red", "+channel"], low: [114, 171, 200], high: [114, 57, 29] }
    ])(`draws selected histogram channels $channels (${format}, retained=${retained})`, async ({ channels, low, high }) => {
        const input = Buffer.concat([
            Buffer.from("P6\n4 2\n255\n"),
            Buffer.from("ff0000".repeat(4) + "00ff00".repeat(2) + "0000ff000000", "hex")
        ]);
        const files = new Map([["in.ppm", new Uint8Array(input)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const output = `out.${format}`;
        expect(await runConvertCli(["in.ppm", ...channels, `histogram:${output}`], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = retained ? await filesystem.readFile(`/${output}`) : files.get(output)!;
        const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        expect([info.width, info.height, info.channels]).toEqual([256, 200, 3]);
        const expected = new Uint8Array(256 * 200 * 3);
        for (let y = 0; y < 200; y++) for (let channel = 0; channel < 3; channel++) {
            if (y >= 200 - low[channel]!) expected[y * 256 * 3 + channel] = 255;
            if (y >= 200 - high[channel]!) expected[(y * 256 + 255) * 3 + channel] = 255;
        }
        expect(Buffer.from(data).equals(expected)).toBe(true);
    });
}
