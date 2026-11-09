import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { channel: "alpha", fill: [255, 255, 255, 128] },
        { channel: "red", fill: [17, 255, 255, 255] },
        { channel: "blue", fill: [255, 255, 119, 255] },
        { channel: "RGB", fill: [17, 68, 119, 255] },
        { channel: "RGBA", fill: [17, 68, 119, 128] }
    ])(`${mode}: floodfill respects $channel and preserves other regions`, async ({ channel, fill }) => {
        const white = [255, 255, 255, 255], black = [0, 0, 0, 255];
        const pixels = [...white, ...white, ...black, ...white, ...white, ...black, ...black, ...white];
        const input = encodeImage({ width: 4, height: 2, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-fill", "red", "-channel", channel, "-fill", "#11447780", "-floodfill", "+0+0", "white", "+channel", "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...fill, ...fill, ...black, ...white, ...fill, ...black, ...black, ...white]);
    });
}
