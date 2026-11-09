import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const depth of [8, 16])
for (const evaluated of [false, true]) {
    it.each([
        { name: "Point resize", operator: "-resize", opaque: false },
        { name: "sample", operator: "-sample", opaque: false },
        { name: "opaque Point resize", operator: "-resize", opaque: true },
    ])(`${mode}: $name preserves native RGBA at depth ${depth}, evaluated=${evaluated}`, async ({ operator, opaque }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI clears hidden RGB only for Point resize.
        const pixels = depth === 8
            ? [[82, 244, 112, 0], [19, 67, 153, 1], [5, 88, 167, 128], [7, 91, 171, 255]]
            : [[21075, 62709, 28785, 0], [4884, 17220, 39322, 1], [1286, 22617, 42920, 32768], [1800, 23388, 43948, 65535]];
        const maximum = depth === 8 ? 255 : 65535;
        if (opaque) for (const pixel of pixels) pixel[3] = maximum;
        const samples = pixels.flat();
        const input = encodeImage({ width: 4, height: 1, format: "png", space: "srgb", channels: opaque ? 3 : 4,
            density: 72, hasAlpha: !opaque, depth: depth === 8 ? "uchar" : "ushort",
            data: Uint8Array.from(samples, value => depth === 8 ? value : Math.round(value / 257)),
            ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}) }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const arithmetic = evaluated ? ["-evaluate", "Add", "0"] : [];
        const args = ["/input.png", ...arithmetic, "-filter", "Point", operator, "8x2!", ...arithmetic, `${depth === 8 ? "PNG32" : "PNG64"}:/out.png`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 2]);
        const row = pixels.flatMap(pixel => {
            const expected = operator === "-resize" && pixel[3] === 0 ? [0, 0, 0, 0] : pixel;
            return [...expected, ...expected];
        });
        expect(Array.from(depth === 8 ? output.data : output.data16!)).toEqual([...row, ...row]);
    });
}
