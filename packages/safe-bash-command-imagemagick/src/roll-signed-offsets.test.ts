import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick applies the geometry sign to the signed offset value.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "+1++1", x: 1, y: 1 },
        { geometry: "+1--1", x: 1, y: 1 },
        { geometry: "+1+-1", x: 1, y: -1 },
        { geometry: "+1-+1", x: 1, y: -1 },
        { geometry: "++1+0", x: 1, y: 0 },
        { geometry: "--1+0", x: 1, y: 0 },
        { geometry: "+-1+0", x: -1, y: 0 },
        { geometry: "-+1+0", x: -1, y: 0 },
        { geometry: "--1+-1", x: 1, y: -1 },
        { geometry: "5x4++1+-1", x: 1, y: -1 },
        { geometry: "+1e+0+-1e+0", x: 1, y: -1 },
        { geometry: "+1+-1+2", x: 1, y: -1 },
        { geometry: "+1+-1%", x: 0, y: 0 },
        { geometry: "+1+-0x1", x: 1, y: -1 },
        { geometry: "+1+1", x: 1, y: 1 },
        { geometry: "+1-1", x: 1, y: -1 },
        { geometry: "+1+0", x: 1, y: 0 },
        { geometry: "-1+0", x: -1, y: 0 },
        { geometry: "+1++-2", x: 1, y: -2 },
        ...Array.from({ length: 4 }, (_, length) =>
            Array.from({ length: 2 ** (length + 1) }, (_, bits) => {
                const signs = Array.from({ length: length + 1 }, (_, bit) => (bits & (1 << bit)) ? "-" : "+").join("");
                const negativeCount = [...signs].filter(sign => sign === "-").length;
                const direction = negativeCount % 2 === 0 ? 1 : -1;
                return [
                    { geometry: `${signs}1+2`, x: direction, y: 2 },
                    { geometry: `+1${signs}1`, x: 1, y: direction },
                ];
            }).flat(),
        ).flat(),
    ])(`applies signed roll offsets in $geometry and preserves the page, ${mode}`, async ({ geometry, x, y }) => {
        const pixels = Uint8Array.from({ length: 36 }, (_, i) => i * 3);
        const input = await sharp(pixels, { raw: { width: 4, height: 3, channels: 3 } }).png().toBuffer();
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["input.png", input], ["out.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", sentinel);
        const args = ["input.png", "-repage", "9x8-2+3", "-roll", geometry, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect(output.virtualCanvas).toEqual({ width: 9, height: 8, x: -2, y: 3 });
        const expected = Array.from({ length: 12 }, (_, i) => {
            const source = (((Math.floor(i / 4) - y + 3) % 3) * 4 + (i % 4 - x + 4) % 4) * 3;
            return [...pixels.subarray(source, source + 3), 255];
        }).flat();
        expect([...output.data]).toEqual(expected);
    });
}
