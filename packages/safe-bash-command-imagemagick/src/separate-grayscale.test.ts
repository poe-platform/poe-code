import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
for (const input of ["converted", "decoded", "rgb"] as const)
for (const alpha of [false, true])
for (const mask of [undefined, "RGBA", ...(input === "rgb" ? [] : ["G", "B"])]) {
    it(`${mode}: separates ${input} planes, alpha=${alpha}, mask=${mask}`, async () => {
        const source = encodeImage({ width: 2, height: 1, format: "png", space: input === "decoded" ? "b-w" : "srgb", depth: "uchar",
            density: 72, channels: input === "decoded" ? (alpha ? 2 : 1) : (alpha ? 4 : 3), hasAlpha: alpha,
            data: new Uint8Array([62, 62, 62, alpha ? 128 : 255, 213, 213, 213, alpha ? 191 : 255]) }, { format: "png" }).data;
        const argv = ["in.png", ...(input === "converted" ? ["-colorspace", "Gray"] : []),
            ...(alpha ? [] : ["-alpha", "off"]), ...(mask ? ["-channel", mask] : []), "-separate", "+append", "out.png"];
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
        const samples = mask === "G" || mask === "B" ? [0, 0] : [...Array.from({ length: input === "rgb" ? 3 : 1 }, () => [62, 213]).flat(), ...(alpha ? [128, 191] : [])];
        expect([output.width, output.height]).toEqual([samples.length, 1]);
        expect(Array.from(output.data)).toEqual(samples.flatMap(value => [value, value, value, 255]));
    });
}
