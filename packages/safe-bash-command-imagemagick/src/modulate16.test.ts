import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
  for (const hasAlpha of [false, true]) {
    it.each([
        { value: "100,100,100", expected: [0x4321, 0x8765, 0xabcd] },
        { value: "80,60,120", expected: [0x4673, 0x4913, 0x78b1] },
    ])(`preserves native Q16 modulation $value via ${mode}, alpha=${hasAlpha}`, async ({ value, expected }) => {
        // ImageMagick 7.1.2 Q16-HDRI reference RGB16 samples.
        const samples = [0x4321, 0x8765, 0xabcd, hasAlpha ? 0x9876 : 65535];
        const input = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", channels: hasAlpha ? 4 : 3,
            density: 72, hasAlpha, depth: "ushort", data16: Uint16Array.from(samples),
            data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-modulate", value, "/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.depth).toBe("ushort");
        expect(Array.from(output.data16 ?? [])).toEqual([...expected, samples[3]]);
    });
}
}
