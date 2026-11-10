import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
    it.each([
        ["1x-1", 0, 0, true], ["-1x1", 0, 0, true], ["-2x2", 0, 0, true],
        ["1x1", 1, 1, false], ["0x1", 0, 1, false], ["1x3", 0, 0, true],
        ["1x+1", 0, 0, true], ["+1x1", 0, 0, true], ["1x-0", 0, 0, true], ["-0x1", 0, 0, true],
        ["1x-1%", 0, 0, false], ["-1x1%", 0, 0, false],
        ["1x1-1-1", 1, 1, false], [" 1 X -1 ", 0, 0, true],
        ["1:-1", 1, 1, false], ["%[fx:1]x%[fx:-1]", 0, 0, true],
    ] as const)(`preserves pixels for signed shave geometry %s (${mode})`, async (geometry, horizontal, vertical, warns) => {
        const pixels = Uint8Array.from({ length: 7 * 6 * 4 }, (_, index) => index % 4 === 3 ? 255 : index % 4 === 0 ? Math.floor(index / 4) : 0);
        const bytes = await sharp(pixels, { raw: { width: 7, height: 6, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const argv = ["/input.png", "-shave", geometry, "PNG24:/output.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" }).then(result => { stderr = result.stderr; return result; });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "map" ? files.get("/output.png")! : await fs.readFile("/output.png"));
        expect([output.width, output.height]).toEqual([7 - horizontal * 2, 6 - vertical * 2]);
        const expected: number[] = [];
        for (let y = vertical; y < 6 - vertical; y++) for (let x = horizontal; x < 7 - horizontal; x++) {
            expected.push(y * 7 + x, 0, 0, 255);
        }
        expect(Array.from(output.data)).toEqual(expected);
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width: output.width, height: output.height, x: 0, y: 0 });
        expect(stderr).toBe(warns ? `magick: geometry does not contain image '/input.png'\n` : "");
    });
}
