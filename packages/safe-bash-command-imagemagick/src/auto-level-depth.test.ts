import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { name: "linked grayscale", channel: undefined, values: [10000, 10016, 10032, 10048], expected: [0, 21845, 43690, 65535] },
        { name: "red only", channel: "R", values: [4800, 4816, 4832, 4864], expected: [0, 16384, 32768, 65535] },
        { name: "green low bits", channel: "G", values: [0x6465, 0x6466, 0x6464, 0x6465], expected: [32768, 65535, 0, 32768] },
        { name: "constant green", channel: "G", values: [0x6465, 0x6465, 0x6465, 0x6465], expected: [0x6465, 0x6465, 0x6465, 0x6465] },
    ])(`${mode}: stretches $name at full depth`, async ({ channel, values, expected }) => {
        const selected = channel === "R" ? 0 : 1;
        const samples = values.flatMap(value => channel
            ? [0x1234, 0x5678, 0x9abc, 0xdef0].map((sample, index) => index === selected ? value : sample)
            : [value, value, value, 65535]);
        const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: channel ? 4 : 3,
            depth: "ushort", density: 72, hasAlpha: !!channel
        }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(channel ? ["-channel", channel] : []), "-auto-level", "+channel", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data16!]).toEqual(samples.map((value, index) =>
            (channel ? index % 4 === selected : index % 4 < 3) ? expected[Math.floor(index / 4)]! : value));
    });
}
