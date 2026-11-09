import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./posterize-riemersma-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: rgb.png [dither options] -posterize <levels> out.png.
// Every reference PNG was independently decoded with magick out.png -depth 8 rgba:-.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each(fixtures.cases)(`${execution}: opaque posterize $levels levels, $mode dithering`, async ({ levels, options, rgba }) => {
        const input = Uint8Array.from(Buffer.from(fixtures.input, "base64"));
        const fs = new MemoryFileSystem(), files = new Map([["in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...options, "-posterize", String(levels), "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([7, 5]);
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
    });
}
