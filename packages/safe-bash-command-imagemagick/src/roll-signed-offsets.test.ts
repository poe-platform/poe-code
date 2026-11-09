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
    ])(`applies signed roll offsets in $geometry and preserves the page, ${mode}`, async ({ geometry, x, y }) => {
        const pixels = Uint8Array.from({ length: 60 }, (_, i) => i * 3);
        const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
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
        expect([output.width, output.height]).toEqual([5, 4]);
        expect(output.virtualCanvas).toEqual({ width: 9, height: 8, x: -2, y: 3 });
        const expected = Array.from({ length: 20 }, (_, i) => {
            const source = (((Math.floor(i / 5) - y + 4) % 4) * 5 + (i % 5 - x + 5) % 5) * 3;
            return [...pixels.subarray(source, source + 3), 255];
        }).flat();
        expect([...output.data]).toEqual(expected);
    });
}
