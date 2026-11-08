import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        ["+2+1", 5, 4],
        ["0x0", 0, 0],
        ["0x0+2+1", 0, 0],
        ["2x1+2+1", 2, 1]
    ] as const)(`preserves omitted versus zero splice dimensions, mode=${mode}, geometry=%s`, async (geometry, sw, sh) => {
        const pixels = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-background", "red", "-splice", geometry, "out.png"];
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
        expect([output.width, output.height]).toEqual([5 + sw, 4 + sh]);
        const expected = [];
        for (let y = 0; y < 4 + sh; y++) {
            for (let x = 0; x < 5 + sw; x++) {
                if ((x >= 2 && x < 2 + sw) || (y >= 1 && y < 1 + sh)) expected.push(255, 0, 0, 255);
                else {
                    const source = ((y < 1 ? y : y - sh) * 5 + (x < 2 ? x : x - sw)) * 4;
                    expected.push(...pixels.subarray(source, source + 4));
                }
            }
        }
        expect(output.data).toEqual(Uint8Array.from(expected));
    });
}
