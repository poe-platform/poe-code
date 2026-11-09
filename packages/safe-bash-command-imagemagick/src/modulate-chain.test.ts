import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        ["200", "50"], ["50", "200"], ["100,200", "100,50"], ["100", "100"],
    ])(`preserves intermediate modulation samples for %s then %s via ${mode}`, async (first, second) => {
        const data = Uint8Array.from(Array.from({ length: 256 }, (_, i) =>
            [i, (31 + 7 * i) % 256, (15 + 29 * i) % 256, (1 + 13 * i) % 256]).flat());
        const input = encodeImage({ width: 16, height: 16, format: "png", space: "srgb",
            channels: 4, density: 72, hasAlpha: true, depth: "uchar", data }, { format: "png" }).data;
        // ImageMagick 7.1.2-31 Q16-HDRI, decoded with -depth 8 rgba:-.
        // Doubling lightness exactly to one loses chroma even with HDRI storage.
        const expected = data.slice();
        if (first === "200") for (const offset of [32, 112, 368, 752, 1008]) expected.fill(128, offset, offset + 3);
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-modulate", first, "-modulate", second, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.data).toEqual(expected);
    });
}
