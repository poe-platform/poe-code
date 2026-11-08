import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

for (const route of ["command", "buffered", "sync"])
for (const stream of ["-", "png:-"])
for (const direction of ["stdin", "stdout"])
it(`${route}: composite accepts ${stream} as ${direction}`, async () => {
    const overlay = await sharp({ create: { width: 2, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    const base = await sharp({ create: { width: 2, height: 1, channels: 4, background: "blue" } }).png().toBuffer();
    const files = new Map([["/a.png", overlay], ["/b.png", base]]);
    const args = [direction === "stdin" ? stream : "/a.png", "/b.png", direction === "stdout" ? stream : "/out.png"];
    const input = direction === "stdin" ? overlay : undefined;
    let output: Uint8Array;
    if (route === "command") {
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const chunks: number[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["composite", ...args]).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { if (input) yield input; })(),
            stdout: { async write(chunk) { chunks.push(...chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = direction === "stdout" ? Uint8Array.from(chunks) : await fs.readFile("/out.png");
    } else {
        const result = route === "sync" ? runCompositeCliSync(args, files, input) : await runCompositeCli(args, files, input);
        expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = direction === "stdout" ? result.stdoutBytes! : files.get("/out.png")!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
});
