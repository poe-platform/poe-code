import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick: magick -size 4x4 xc:red xc:blue +append -depth 8 in.dds
const fixture = Buffer.from("444453207c00000007100a000400000008000000100000000000000004000000494d4147454d414749434b0000000000000000000000000000000000000000000000000000000000000000002000000004000000445854310000000000000000000000000000000000000000081040000000000000000000000000000000000000f800f8000000001f001f000000000000f800f80000000004d804d8000000001bd80a50abaaaaaa", "hex");
const rgb = Buffer.from(("ff0000".repeat(4) + "0000ff".repeat(4)).repeat(4), "hex");
for (const input of ["in.dds", "dds:in.dds"]) {
    for (const metadata of [false, true]) it(`reads native DXT1 through public magick: ${input}, metadata=${metadata}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.dds", fixture);
        const args = createCommandArguments(metadata ? [input, "-format", "%n %w %h", "info:"] : [input, "-depth", "8", "rgb:-"]);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(chunks)).toEqual(metadata ? Buffer.from("1 8 4") : rgb);
    });
    it(`preserves native frame count and dimensions: ${input}`, () => {
        const files = new Map([["in.dds", fixture]]);
        const result = runConvertCliSync([input, "-format", "%n %w %h", "info:"], files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "1 8 4" });
    });
}
