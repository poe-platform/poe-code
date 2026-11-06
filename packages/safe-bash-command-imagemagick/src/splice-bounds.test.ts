import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli } from "./index.js";

it.each([
    ["1x0-1+0", 1, 0, -1, 0],
    ["1x0+5+0", 1, 0, 5, 0],
    ["1x0+4+0", 1, 0, 4, 0],
    ["1x1+0+5", 1, 1, 0, 5]
] as const)("preserves splice dimensions and offsets: %s", (geometry, width, height, x, y) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ width, height, x, y });
});

for (const mode of ["buffered", "retained", "command"]) {
    it.each(["1x0-1+0", "1x0+5+0", "1x0+4+0", "1x1+0+5"])(`matches native splice bounds, mode=${mode}, geometry=%s`, async geometry => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-gravity", "NorthWest", "-splice", geometry, "out.png"];
        let exitCode: number | undefined, stderr = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } } });
            exitCode = result.exitCode;
        } else {
            const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            stderr = result.stderr;
        }
        if (geometry === "1x1+0+5") {
            expect(exitCode).toBe(1);
            expect(stderr).toContain("pixels are not authentic");
            expect(files.has("out.png")).toBe(false);
            expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["input.png"]);
        } else {
            expect(exitCode).toBe(0);
            const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([5, 3]);
            // Native ImageMagick repeats the edge outside the horizontal bounds;
            // the exact boundary still inserts the background color.
            const values = [1, 2, 3, 4, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 12];
            if (geometry === "1x0+4+0") for (const index of [4, 9, 14]) values[index] = 255;
            expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
        }
    });
}
