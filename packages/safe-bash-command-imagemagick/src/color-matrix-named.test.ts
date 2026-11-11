import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

const pixels = [200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200];

// Reference samples decoded from native ImageMagick's PNG32 output.
it.each([
    { kernel: "Sobel", expected: [138, 255, 138, 128, 0, 0, 0, 255, 0, 0, 0, 200] },
    { kernel: "Unity", expected: pixels },
    { kernel: "Unity:", expected: pixels },
    { kernel: "Unity:0", expected: [0, 21, 62, 128, 0, 99, 51, 255, 0, 0, 0, 200] },
    { kernel: "Unity:1", expected: pixels },
    { kernel: "Unity:2", expected: [255, 21, 62, 128, 30, 99, 51, 255, 0, 0, 0, 200] },
    { kernel: "Square:1", expected: [255, 255, 255, 128, 165, 165, 165, 255, 0, 0, 0, 200] },
    { kernel: "1 0 0 0 1 0 0 0 1", expected: pixels }
])("magick applies the $kernel color matrix through the command API", async ({ kernel, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", await sharp(Uint8Array.from(pixels), {
        raw: { width: 3, height: 1, channels: 4 }
    }).png().toBuffer());
    const args = createCommandArguments(["in.png", "-color-matrix", kernel, "PNG32:out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(await fs.readFile("/out.png")).data]).toEqual(expected);
});
