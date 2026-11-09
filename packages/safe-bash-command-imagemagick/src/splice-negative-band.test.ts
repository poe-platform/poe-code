import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        ["2x1-1+0", [255, 1, 2, 3, 4, 5, 6, 7, 7]],
        ["2x1-2+0", [1, 2, 3, 4, 5, 6, 7, 7, 7]],
        ["2x1-3+0", [1, 2, 3, 4, 5, 6, 7, 7, 7]]
    ] as const)(`matches native negative splice bands, mode=${mode}, geometry=%s`, async (geometry, firstRow) => {
        const pixels = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", new TextEncoder().encode("keep")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["in.png", "-splice", geometry, "out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([9, 6]);
        // Native ImageMagick clips the inserted band and extends the right edge.
        const expected = Array<number>(9).fill(255);
        for (let row = 0; row < 5; row++) expected.push(...firstRow.map(value => value === 255 ? value : value + row * 7));
        expect(output.data).toEqual(Uint8Array.from(expected.flatMap(value => [value, value, value, 255])));
    });
}
