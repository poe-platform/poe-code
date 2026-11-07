import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PNG64 input with adjacent alpha samples 0x1234 and 0x1235.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAB3RJTUUH6gsHBzkcjsZcnAAAABRJREFUCNdjFDIJq5i1R8iEAQIYASDvArM+9YL1AAAAAElFTkSuQmCC", "base64");

for (const alpha of [false, true])
for (const operation of [["-sample"], ["-filter", "point", "-resize"]])
for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}, alpha=${alpha}: ${operation.join(" ")}: preserves exact 16-bit pixels when enlarging`, async () => {
        const a = [0x1234, 0x5678, 0x9abc, alpha ? 0x1234 : 0xffff];
        const b = [0x1235, 0x5678, 0x9abc, alpha ? 0x1235 : 0xffff];
        const source = encodeImage({ ...decodeImage(input), hasAlpha: alpha, channels: alpha ? 4 : 3,
            data: Uint8Array.from([...a, ...b], value => Math.round(value / 257)),
            data16: Uint16Array.from([...a, ...b]) }, { format: "png" }).data;
        const argv = ["in.png", ...operation, "4x2!", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", source);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...output.subarray(24, 26)]).toEqual([16, alpha ? 6 : 2]);
        const image = decodeImage(output);
        expect(image.width).toBe(4);
        expect(image.height).toBe(2);
        expect([...image.data16!]).toEqual([...a, ...a, ...b, ...b, ...a, ...a, ...b, ...b]);
    });
}
