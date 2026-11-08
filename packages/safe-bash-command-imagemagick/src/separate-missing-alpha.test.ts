import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
for (const evaluate of [false, true])
for (const alpha of [false, true])
for (const channel of ["A", "RGBA", "RA", "default"])
it(`${mode}: separates ${channel} from ${alpha ? "RGBA" : "RGB"} input, evaluate=${evaluate}`, async () => {
    const pixels = [18, 69, 120, alpha ? 128 : 255, 171, 239, 86, alpha ? 192 : 255];
    const source = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: "uchar",
        density: 72, channels: alpha ? 4 : 3, hasAlpha: alpha, data: Uint8Array.from(pixels) }, { format: "png" }).data;
    const argv = ["in.png", ...(evaluate ? ["-evaluate", "Add", "0"] : []), ...(channel === "default" ? [] : ["-channel", channel]), "-separate", "+append", "out.png"];
    const files = new Map([["in.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", source);
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : mode === "buffered" ? await runMagickCli(argv, files)
        : await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
    const channels = channel === "A" ? [3] : channel === "RA" ? alpha ? [0, 3] : [0] : alpha ? [0, 1, 2, 3] : [0, 1, 2];
    expect([output.width, output.height]).toEqual([channels.length * 2, 1]);
    expect(Array.from(output.data)).toEqual(channels.flatMap(index => [0, 4].flatMap(offset => {
        const value = index === 3 && !alpha ? 0 : pixels[offset + index]!;
        return [value, value, value, 255];
    })));
});
