import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of [0x9876, 65535]) {
        for (const [geometry, expected] of [
            ["1 0 0 0 1 0 0 0 1", [0x4321, 0x8765, 0xabcd, alpha]],
            ["0 1 0 1 0 0 0 0 1", [0x8765, 0x4321, 0xabcd, alpha]]
        ] as const) {
            it.each(["-color-matrix", "-recolor"])(`${mode}, alpha=${alpha}: preserves native 16-bit samples for ${geometry} with %s`, async option => {
                const samples = [0x4321, 0x8765, 0xabcd, alpha];
                const input = encodeImage({ width: 1, height: 1,
                    data: Uint8Array.from(samples, value => Math.round(value / 257)),
                    data16: Uint16Array.from(samples), format: "png", space: "srgb",
                    channels: alpha === 65535 ? 3 : 4, depth: "ushort", density: 72, hasAlpha: alpha !== 65535
                }, { format: "png" }).data;
                const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["in.png", option, geometry, "out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
                expect(output[24]).toBe(16);
                expect([...decodeImage(output).data16!]).toEqual([...expected]);
            });
        }
    }
}
