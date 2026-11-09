import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command", "mogrify"] as const) {
    // ImageMagick 7.1.2-35: area limits use the requested frame dimensions.
    it.each([
        ["2@", 1, 1], ["4@", 2, 2], ["1x2@", 1, 1],
        ["1x1", 1, 1], ["2x2", 2, 2], ["2x4@", 1, 2],
        ["4x1@", 4, 1], ["9@", 4, 4], ["0@", 0, 0],
        ["0.25@", 0, 0], ["2x@", 2, 0], ["x2@", 0, 2],
    ] as const)(`resolves -frame %s area dimensions (${mode})`, async (geometry, horizontal, vertical) => {
        const data = Uint8Array.from({ length: 7 * 6 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = encodeImage({ width: 7, height: 6, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const options = ["-mattecolor", "#4275ac", "-frame", geometry];
        const argv = ["/input.png", ...options, "/output.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem: fs, cwd: "/" })
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/output.png")! : await fs.readFile(mode === "mogrify" ? "/input.png" : "/output.png"));
        const width = 7 + horizontal * 2, height = 6 + vertical * 2;
        expect([output.width, output.height]).toEqual([width, height]);
        const expected: number[] = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const sourceX = x - horizontal, sourceY = y - vertical;
            const inside = sourceX >= 0 && sourceX < 7 && sourceY >= 0 && sourceY < 6;
            const gray = sourceY * 7 + sourceX + 1;
            expected.push(...(inside ? [gray, gray, gray, 255] : [66, 117, 172, 255]));
        }
        expect(Array.from(output.data)).toEqual(expected);
    });
}
