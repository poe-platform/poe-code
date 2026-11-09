import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples for this seven-pixel ramp.
for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { operator: "-level", geometry: "25%,75%", expected: [0, 0, 1, 32769, 65535, 65535, 65535] },
        { operator: "-level", geometry: "25%,75%!", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "-level", geometry: "!25%,75%", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "-level", geometry: "25%x75%!", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "-level", geometry: "16383.75,49151.25!", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "-level", geometry: "25%,75%,2!", expected: [16384, 16384, 18432, 24576, 34815, 49150, 49151] },
        { operator: "+level", geometry: "25%,75%", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "+level", geometry: "25%,75%!", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "+level", geometry: "25%,75%,2!", expected: [16384, 16384, 18432, 24576, 34815, 49150, 49151] },
    ])(`matches native $operator $geometry via ${mode}`, async ({ operator, geometry, expected }) => {
        const samples = [0, 1, 16384, 32768, 49151, 65534, 65535].flatMap(value => [value, value, value, 65535]);
        const input = encodeImage({ width: 7, height: 1, format: "png", space: "srgb", channels: 3,
            density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
            data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", operator, geometry, "PNG48:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.depth).toBe("ushort");
        expect(Array.from(output.data16 ?? [])).toEqual(expected.flatMap(value => [value, value, value, 65535]));
    });
}
