import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "command", "mogrify"] as const)
for (const [option, amount, geometry] of [
    ["-swirl", "120", "120x5"],
    ["-swirl", "2", "2x1+1"],
    ["-swirl", "2", "2x1-1"],
    ["-implode", "2", "2x1+1"],
    ["-implode", "2", "2x1-1"],
    ["-wave", "2x1", "2x1+1"],
    ["-wave", "2x1", "2x1-1"],
    ["-swirl", "120", "120%"],
    ["-implode", "1.5", "1.5x2"],
    ["-implode", "1.5", "1.5%"],
    ["-swirl", "1", "+1"],
    ["-swirl", "-1", "-1"],
    ["-swirl", "1", "+1%"],
    ["-swirl", "1", "1@"],
    ["-implode", "1", "+1"],
    ["-implode", "-1", "-1"],
    ["-swirl", "20", "2 0"],
    ["-implode", "20", "2 0"],
    ["-wave", "20", "2 0"],
    ["-wave", "2x10", " 2 x 1 0 "],
    ["-wave", "0x7", "x7"],
    ["-wave", "2x1", "2"],
    ["-wave", "2x1", "2x"]
]) {
    it(`${mode}: ${option} ${geometry} uses the first geometry value`, async () => {
        const pixels = Uint8Array.from({ length: 9 * 7 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        expect(runConvertCliSync(["/input.png", option!, amount!, "/expected.png"], files).exitCode).toBe(0);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const argv = mode === "mogrify" ? ["mogrify", option!, geometry!, "/input.png"] : ["/input.png", option!, geometry!, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/out.png")!
            : await filesystem.readFile(mode === "mogrify" ? "/input.png" : "/out.png"));
        const expected = decodeImage(files.get("/expected.png")!);
        expect([output.width, output.height]).toEqual([expected.width, expected.height]);
        expect(output.data).toEqual(expected.data);
    });
}
