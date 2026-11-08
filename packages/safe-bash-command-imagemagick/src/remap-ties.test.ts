import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGB results verified with native ImageMagick's +dither -remap.
const cases = [
    { colors: [255, 0, 0, 0, 255, 0, 0, 0, 255], input: [96, 96, 96], expected: [0, 0, 255] },
    { colors: [255, 0, 0, 0, 255, 0, 0, 0, 255], input: [128, 128, 160], expected: [0, 0, 255] },
    { colors: [2, 0, 0, 0, 2, 0, 0, 0, 2], input: [1, 1, 1], expected: [0, 0, 2] },
    { colors: [128, 0, 0, 0, 128, 0], input: [64, 64, 0], expected: [0, 128, 0] },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it(`${mode}: resolves equal remap distances in native color-tree order`, async () => {
        for (const fixture of cases) for (const reverse of [false, true]) {
            const colors = Array.from({ length: fixture.colors.length / 3 }, (_, i) => fixture.colors.slice(i * 3, i * 3 + 3));
            if (reverse) colors.reverse();
            const palette = await sharp(Uint8Array.from(colors.flat()), { raw: { width: colors.length, height: 1, channels: 3 } }).png().toBuffer();
            const input = await sharp(Uint8Array.from(fixture.input), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
            const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", "+dither", "-remap", "palette.png", "out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(Array.from(decodeImage(output).data)).toEqual([...fixture.expected, 255]);
        }
    });
}
