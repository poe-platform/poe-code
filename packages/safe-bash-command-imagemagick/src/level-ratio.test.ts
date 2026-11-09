import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    // Native ImageMagick Q16 samples, including both endpoints of the ratio mapping.
    it.each([
        { operator: "+level", endpoints: "20:65%", expected: [202, 202, 315, 429, 542, 655, 655] },
        { operator: "+level", endpoints: "20,65%", expected: [13107, 13107, 20480, 27853, 35225, 42597, 42598] },
        { operator: "+level", endpoints: "20:65", expected: [0, 0, 0, 1, 1, 1, 1] },
        { operator: "+level", endpoints: "2:1%", expected: [1311, 1311, 1147, 983, 819, 655, 655] },
        { operator: "+level", endpoints: "20:65%,2", expected: [202, 202, 230, 315, 457, 655, 655] },
        { operator: "-level", endpoints: "20:65%", expected: [0, 0, 65535, 65535, 65535, 65535, 65535] },
        { operator: "-level", endpoints: "0:65%", expected: [0, 100, 65535, 65535, 65535, 65535, 65535] },
    ])(`preserves native Q16 samples for $operator $endpoints via ${mode}`, async ({ operator, endpoints, expected }) => {
        const samples = [0, 1, 16384, 32768, 49151, 65534, 65535].flatMap(value => [value, value, value, 65535]);
        const input = encodeImage({ width: 7, height: 1, format: "png", space: "srgb", channels: 3,
            density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
            data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", operator, endpoints, "/out.png"];
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
