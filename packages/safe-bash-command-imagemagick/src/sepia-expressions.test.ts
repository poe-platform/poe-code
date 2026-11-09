import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const retained of [false, true])
it.each(["80%", "52428", "%[fx:w*20]%", "%[fx:w*13107]"])(`resolves image-dependent sepia thresholds: %s (retained=${retained})`, async threshold => {
    const pixels = Uint8Array.from([220,40,70,255, 40,200,100,128, 25,100,220,0, 66,85,190,255]);
    const input = await sharp(pixels, { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", "-sepia-tone", threshold, "PNG32:out.png"];
    const result = retained ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : await runConvertCli(args, files);
    expect(result.exitCode).toBe(0);
    // Native ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output.
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual([
        92,0,0,255, 255,243,77,88, 142,29,0,0, 125,15,0,255
    ]);
});
