import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    { geometry: "50%", percentX: 50, percentY: 50 },
    { geometry: "25x100%", percentX: 25, percentY: 100 },
    { geometry: "62.5x50%", percentX: 62.5, percentY: 50 }
])("parses extent percentages $geometry", ({ geometry, percentX, percentY }) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ isPercent: true, percentX, percentY });
});

for (const mode of ["buffered", "sync", "retained", "command"]) {
    // Native ImageMagick results for an opaque 4x3 grayscale grid numbered 1–12.
    it.each([
        { geometry: "50%", gravity: "northwest", width: 2, height: 2, values: [1, 2, 5, 6] },
        { geometry: "25x100%", gravity: "center", width: 1, height: 3, values: [2, 6, 10] },
        { geometry: "62.5x50%", gravity: "northwest", width: 3, height: 2, values: [1, 2, 3, 5, 6, 7] },
        { geometry: "2x2", gravity: "northwest", width: 2, height: 2, values: [1, 2, 5, 6] }
    ])(`resolves extent $geometry with $gravity gravity via ${mode}`, async ({ geometry, gravity, width, height, values }) => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-gravity", gravity, "-extent", geometry, "output.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/output.png") : files.get("output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}
