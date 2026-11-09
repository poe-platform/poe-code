import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
    ["-chop", 5, 4, [1, 2, 5, 6, 7, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30, 33, 34, 35]],
    ["-shave", 3, 3, [10, 11, 12, 17, 18, 19, 24, 25, 26]],
    ["-splice", 9, 6, [1, 2, 255, 255, 3, 4, 5, 6, 7,
        255, 255, 255, 255, 255, 255, 255, 255, 255,
        8, 9, 255, 255, 10, 11, 12, 13, 14,
        15, 16, 255, 255, 17, 18, 19, 20, 21,
        22, 23, 255, 255, 24, 25, 26, 27, 28,
        29, 30, 255, 255, 31, 32, 33, 34, 35]]
] as const;

for (const mode of ["sync", "buffered", "retained", "command"]) {
    it.each(cases)(`preserves native dimensions and pixels with hexadecimal offsets: ${mode} %s`, async (option, width, height, red) => {
        const pixels = Uint8Array.from(Array.from({ length: 35 }, (_, i) => [i + 1, 0, 0, 255]).flat());
        const input = await sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } }).png().toBuffer();
        for (const geometry of ["2x1+2+1", "2x1+0x2+0x1", "2x1+0X2+1", "2x1+2+0x1"]) {
            const files = new Map([["in.png", input], ["out.png", new TextEncoder().encode("keep")]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            await filesystem.writeFile("/out.png", new TextEncoder().encode("keep"));
            const args = ["in.png", option, geometry, "out.png"];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                expect(result.exitCode).toBe(0);
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result.exitCode).toBe(0);
            }
            const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([width, height]);
            expect(output.data).toEqual(Uint8Array.from(red.flatMap(value => [value, value === 255 ? 255 : 0, value === 255 ? 255 : 0, 255])));
        }
    });
}
