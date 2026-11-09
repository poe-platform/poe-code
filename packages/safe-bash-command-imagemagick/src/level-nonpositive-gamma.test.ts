import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const samples = [0, 1, 16384, 32768, 49151, 65534, 65535];
const rgba = samples.flatMap(value => [value, value, value, 65535]);
const input = encodeImage({ width: samples.length, height: 1, format: "png", space: "srgb", channels: 3,
    density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(rgba),
    data: Uint8Array.from(rgba, value => Math.round(value / 257)) }, { format: "png" }).data;

// ImageMagick 7.1.2-35 Q16-HDRI: magick in.png OP GEOMETRY PNG48:out.png,
// decoded with magick out.png -depth 16 -endian MSB rgb:-.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operator: "+level", geometry: "25%,75%,0", expected: [49151, 49151, 49151, 49151, 49151, 49151, 49151] },
        { operator: "+level", geometry: "25%,75%,-1", expected: [65535, 65535, 65535, 65535, 60074, 49152, 49151] },
        { operator: "+level", geometry: "25%,75%,-2", expected: [65535, 65535, 65535, 65535, 65535, 49152, 49151] },
        { operator: "+level", geometry: "25%,75%,0.005", expected: [16384, 47384, 48925, 49038, 49104, 49151, 49151] },
        { operator: "+level", geometry: "25%,75%,1", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "+level", geometry: "25%,75%", expected: [16384, 16384, 24576, 32768, 40959, 49151, 49151] },
        { operator: "-level", geometry: "25%,75%,0", expected: [0, 0, 0, 0, 0, 65535, 65535] },
        { operator: "-level", geometry: "25%,75%,-1", expected: [0, 0, 65535, 65535, 65535, 43691, 43690] },
        { operator: "-level", geometry: "25%,75%,-2", expected: [0, 0, 65535, 65535, 65535, 53510, 53509] },
        { operator: "-level", geometry: "25%,75%,0.005", expected: [0, 0, 0, 0, 65435, 65535, 65535] },
        { operator: "-level", geometry: "25%,75%,1", expected: [0, 0, 1, 32769, 65535, 65535, 65535] },
        { operator: "-level", geometry: "25%,75%", expected: [0, 0, 1, 32769, 65535, 65535, 65535] },
        { operator: "-level", geometry: "0%,100%,0", expected: [0, 0, 0, 0, 0, 0, 65535] },
    ])(`preserves native $operator $geometry samples via ${mode}`, async ({ operator, geometry, expected }) => {
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", operator, geometry, "PNG48:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.depth).toBe("ushort");
        expect(Array.from(output.data16 ?? [])).toEqual(expected.flatMap(value => [value, value, value, 65535]));
    });
}
