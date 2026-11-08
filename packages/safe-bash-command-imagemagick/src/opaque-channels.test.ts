import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        for (const operator of ["-opaque", "+opaque", "-transparent", "+transparent"]) {
            for (const channel of [undefined, "R", "G", "B", "A", "RG", "RGBA"]) {
                it(`${mode}, ${depth}-bit: ${operator} respects ${channel ?? "default"} painting channels`, async () => {
                    const pixels = [0x19, 0x64, 0xdc, 0x80, 0x1a, 0x64, 0xdc, 0x80];
                    const samples = pixels.map(value => value * 257);
                    samples[4] += 1;
                    const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(pixels),
                        ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}),
                        format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true
                    }, { format: "png" }).data;
                    const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
                    await fs.writeFile("/in.png", input);
                    const argv = ["in.png", "-fill", "#aabbcc44", ...(channel ? ["-channel", channel] : []), operator, "#1964dc80", depth === 16 ? "PNG64:out.png" : "PNG32:out.png"];
                    const args = createCommandArguments(argv);
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write() {} }
                    }) : mode === "sync" ? runConvertCliSync(argv, files)
                        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    const offset = operator.startsWith("+") ? 4 : 0;
                    if (operator.endsWith("transparent")) pixels[offset + 3] = samples[offset + 3] = 0;
                    else for (const [index, name] of [..."RGBA"].entries()) {
                        if (!channel || channel.includes(name)) {
                            pixels[offset + index] = [0xaa, 0xbb, 0xcc, 0x44][index]!;
                            samples[offset + index] = pixels[offset + index]! * 257;
                        }
                    }
                    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
                    expect([...decodeImage(output).data]).toEqual(pixels);
                    if (depth === 16) expect([...decodeImage(output).data16!]).toEqual(samples);
                });
            }
        }
    }
}
