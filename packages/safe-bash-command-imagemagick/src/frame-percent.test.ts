import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
    it.each([
        ["20x25%", 2, 2], ["10%", 1, 1], ["2x2", 2, 2], ["2x", 2, 0],
        ["2x3", 2, 3], ["(2x3)", 2, 3],
    ] as const)(`-frame %s resolves frame dimensions against the source raster (${mode})`, async (geometry, horizontal, vertical) => {
        const pixels = Uint8Array.from({ length: 320 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 10, height: 8, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const argv = ["/input.png", "-mattecolor", "red", "-frame", geometry, "/output.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" }).then(result => { stderr = result.stderr; return result; });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "map" ? files.get("/output.png")! : await fs.readFile("/output.png"));
        const width = 10 + horizontal * 2, height = 8 + vertical * 2;
        expect([output.width, output.height]).toEqual([width, height]);
        const expected: number[] = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const sourceX = x - horizontal, sourceY = y - vertical;
            const gray = sourceX >= 0 && sourceX < 10 && sourceY >= 0 && sourceY < 8 ? sourceY * 10 + sourceX + 1 : 0;
            expected.push(gray || 255, gray, gray, 255);
        }
        expect(Array.from(output.data)).toEqual(expected);
    });
}
