import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { settings: ["-interpolate", "nearest-neighbor"], row: [255, 130, 40, 70, 255, 255] },
        { settings: ["-interpolate", "nearest"], row: [255, 130, 40, 70, 255, 255] },
        { settings: [], row: [248, 115, 73, 96, 202, 255] },
        { settings: ["-interpolate", "nearest-neighbor", "+interpolate"], row: [248, 115, 73, 96, 202, 255] },
    ])(`matches native point-filter rotation via ${mode}: $settings`, async ({ settings, row }) => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(value => [value, value, value]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...settings, "-filter", "point", "-rotate", "30", "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([6, 6]);
        expect(Array.from(output.data.slice(2 * 6 * 4, 3 * 6 * 4))).toEqual(row.flatMap(value => [value, value, value, 255]));
        if (row[1] === 130) {
            // Native ImageMagick 7 Q16-HDRI, including background and untouched samples.
            const expected = [
                255, 255, 255, 255, 255, 255,
                255, 255, 255, 255, 255, 255,
                255, 130, 40, 70, 255, 255,
                255, 255, 160, 190, 100, 255,
                255, 255, 255, 255, 255, 255,
                255, 255, 255, 255, 255, 255,
            ];
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        }
    });
}
