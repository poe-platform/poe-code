import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = [0, 40, 90, 0, 80, 100, 150, 128, 200, 50, 70, 255];
// Native PNG64 fixture with adjacent alpha samples that must remain distinct.
const png16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAB3RJTUUH6gsHBzkcjsZcnAAAABRJREFUCNdjFDIJq5i1R8iEAQIYASDvArM+9YL1AAAAAElFTkSuQmCC", "base64");
for (const execution of ["command", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each(["discrete", "extract", "activate"])(`${execution}: ${depth}-bit alpha discrete then %s preserves stored opacity`, async operation => {
            const input = depth === 16 ? png16 : await sharp(Uint8Array.from(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
            const original = decodeImage(input);
            const argv = ["in.png", "-background", "#123456", "-alpha", "discrete", "-write", "PNG32:opaque.png", ...(operation === "discrete" ? [] : ["-alpha", operation]), depth === 16 ? "PNG64:out.png" : "PNG32:out.png"];
            const files = new Map<string, Uint8Array>([["in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = execution === "sync" ? runMagickCliSync(argv, files)
                : execution === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const samples = depth === 16 ? original.data16! : original.data;
            const maximum = depth === 16 ? 65535 : 255;
            expect([...(depth === 16 ? output.data16! : output.data)]).toEqual([...samples].map((value, index) =>
                operation === "extract" ? (index % 4 === 3 ? maximum : samples[index - index % 4 + 3])
                    : operation === "discrete" && index % 4 === 3 ? maximum : value));
            const opaque = decodeImage(execution === "command" ? await fs.readFile("/opaque.png") : files.get("opaque.png")!);
            expect([...opaque.data]).toEqual([...original.data].map((value, index) => index % 4 === 3 ? 255 : value));
        });
    }
}
