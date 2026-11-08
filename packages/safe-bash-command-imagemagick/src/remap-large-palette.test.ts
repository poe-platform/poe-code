import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const execution of ["buffered", "retained", "sync", "command"] as const) {
    it.each([false, true])(`${execution}: uses the entire remap palette with dithering %s`, async dither => {
        for (const count of [256, 1024]) for (const reverse of [false, true]) {
            const colors = Array.from({ length: count }, (_, i) => [i % 256, 0, Math.floor(i / 256), 255]);
            colors.push([0, 255, 0, 255]);
            if (reverse) colors.reverse();
            const palette = await sharp(Uint8Array.from(colors.flat()), { raw: { width: colors.length, height: 1, channels: 4 } }).png().toBuffer();
            const input = await sharp(new Uint8Array([0, 255, 0, 255, 0, 254, 0, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", input], ["palette.png", palette]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["input.png", ...(dither ? ["-dither", "FloydSteinberg"] : ["+dither"]), "-remap", "palette.png", "out.png"];
            const args = createCommandArguments(argv);
            const result = execution === "command"
                ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem,
                })
                : execution === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = execution === "command" || execution === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect(Array.from(decodeImage(output).data)).toEqual([0, 255, 0, 255, 0, 255, 0, 255]);
        }
    });
}
