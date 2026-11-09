import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const axis of ["x", "y"] as const) it.each([
        { coordinate: 0.5, selected: 0 },
        { coordinate: 1.5, selected: 1 },
        { coordinate: 2.49, selected: 2 },
        { coordinate: 2.5, selected: 2 },
        { coordinate: 2.51, selected: 3 },
        { coordinate: 3.5, selected: 3 }
    ])(`${mode}: draw floodfill rounds ${axis}=$coordinate toward the lower pixel at ties`, async ({ coordinate, selected }) => {
        const width = axis === "x" ? 5 : 3, height = axis === "y" ? 5 : 3;
        const pixels = Array.from({ length: width * height }, (_, i) => {
            const position = axis === "x" ? i % width : Math.floor(i / width);
            return position === 2 ? [0, 0, 0, 255] : [255, 255, 255, 255];
        }).flat();
        const input = encodeImage({ width, height, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-fill", "red", "-draw", `color ${axis === "x" ? coordinate : 0},${axis === "y" ? coordinate : 0} floodfill`, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(Array.from({ length: width * height }, (_, i) => {
            const position = axis === "x" ? i % width : Math.floor(i / width);
            const painted = selected === 2 ? position === 2 : selected < 2 ? position < 2 : position > 2;
            return painted ? [255, 0, 0, 255] : pixels.slice(i * 4, i * 4 + 4);
        }).flat());
    });
}
