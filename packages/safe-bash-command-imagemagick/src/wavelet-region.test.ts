import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, decoded RGBA8 comparison.
const input = readFileSync(new URL("./fixtures/wavelet-region-input.png", import.meta.url));


for (const mode of ["command", "memory"])
it.each(["native", "zero-native", "opaque-native", "clipped-native"])(`matches native wavelet denoising inside and outside a region (${mode}, %s)`, async kind => {
    const expected = decodeImage(readFileSync(new URL(`./fixtures/wavelet-region-${kind}.png`, import.meta.url)));
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const files = new Map([["/input.png", new Uint8Array(input)]]);
    const args = ["/input.png", ...(kind === "opaque-native" ? ["-alpha", "off"] : []), "-region", kind === "clipped-native" ? "16x16-8-8" : "16x16+8+8", "-wavelet-denoise", kind === "zero-native" ? "0" : "6%", "+region", "PNG32:/out.png"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([expected.width, expected.height]);
    expect(output.data).toEqual(expected.data);
});
