import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createImagemagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const alpha of [false, true]) for (const mode of ["public", "buffered", "sync"] as const) it(`matches native point-filter circle downscaling: ${mode}, alpha=${alpha}`, async () => {
    // ImageMagick 7.1.2: -size 32x24 xc:black -fill white -draw 'circle 16,12 24,12'.
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", readFileSync(new URL(alpha ? "./fixtures/circle-alpha.png" : "./fixtures/circle.png", import.meta.url)));
    const args = ["/input.png", "-filter", "point", "-resize", "7x5!", "/output.png"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
        signal: new AbortController().signal, fs,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    const files = new Map([["/input.png", await fs.readFile("/input.png")]]);
    const result = mode === "public" ? await createImagemagickCommand().execute(context)
        : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "public" ? await fs.readFile("/output.png") : files.get("/output.png")!);
    expect([output.width, output.height]).toEqual([7, 5]);
    // Native: circle.png -filter point -resize '7x5!' output.png.
    expect([...output.data]).toEqual([
        0, 0, 0, 0, 0, 0, 0,
        0, 0, 255, 255, 255, 0, 0,
        0, 0, 255, 255, 255, 0, 0,
        0, 0, 255, 255, 255, 0, 0,
        0, 0, 0, 0, 0, 0, 0
    ].flatMap(value => [value, value, value, alpha ? value : 255]));
});
