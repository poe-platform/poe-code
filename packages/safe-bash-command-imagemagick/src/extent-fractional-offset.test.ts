import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"]) {
    // Native ImageMagick pixels for a 5x4 grid numbered 0–19.
    it.each([
        { geometry: "3x2+0.5+0.5", gravity: "southeast", values: [12, 13, 14, 17, 18, 19] },
        { geometry: "3x2-0.5-0.5", gravity: "southeast", values: [12, 13, 14, 17, 18, 19] },
        { geometry: "3x2+1.5+1.5", gravity: "southeast", values: [6, 7, 8, 11, 12, 13] },
        { geometry: "3x2-1.5-1.5", gravity: "southeast", values: [18, 19, 255, 255, 255, 255] },
        { geometry: "3x2+0+0", gravity: "southeast", values: [12, 13, 14, 17, 18, 19] },
        { geometry: "3x2+1+1", gravity: "southeast", values: [6, 7, 8, 11, 12, 13] },
        { geometry: "3x2+0.5+0.5", gravity: "northwest", values: [0, 1, 2, 5, 6, 7] },
        { geometry: "3x2-0.5-0.5", gravity: "northwest", values: [0, 1, 2, 5, 6, 7] },
        { geometry: "3x2+0.5+0.5", gravity: "center", values: [6, 7, 8, 11, 12, 13] },
        { geometry: "3x2-0.5-0.5", gravity: "center", values: [6, 7, 8, 11, 12, 13] }
    ])(`resolves extent $geometry with $gravity gravity via ${mode}`, async ({ geometry, gravity, values }) => {
        const pixels = Uint8Array.from({ length: 80 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4));
        const bytes = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-background", "white", "-gravity", gravity, "-extent", geometry, "output.png"];
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
        expect([output.width, output.height]).toEqual([3, 2]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}
