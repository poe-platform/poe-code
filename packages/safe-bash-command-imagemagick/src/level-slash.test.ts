import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const operator of ["-level", "+level"] as const) {
    for (const mode of ["buffered", "sync", "command"] as const) {
        it.each(["20/65%", "20,65%", "20%/65%", "13107/42597.75", "20/65%/2", "20/65%,2", "20,65%,2"])(`reads slash-separated endpoints for ${operator} %s via ${mode}`, async (endpoints) => {
            // ImageMagick 7.1.2-35 Q16-HDRI reference samples, with noncomplementary endpoints.
            const gamma = endpoints.endsWith("2");
            const expected = operator === "+level"
                ? gamma ? [13107, 13107, 14950, 20480, 29695, 42597, 42598] : [13107, 13107, 20480, 27853, 35225, 42597, 42598]
                : gamma ? [0, 0, 21846, 53510, 65535, 65535, 65535] : [0, 0, 7282, 43691, 65535, 65535, 65535];
            const samples = [0, 1, 16384, 32768, 49151, 65534, 65535].flatMap(value => [value, value, value, 65535]);
            const input = encodeImage({ width: 7, height: 1, format: "png", space: "srgb", channels: 3,
                density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
                data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["/in.png", operator, endpoints, "PNG48:/out.png"];
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
}
