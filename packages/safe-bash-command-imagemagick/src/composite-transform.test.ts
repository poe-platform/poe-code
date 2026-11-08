import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

for (const route of ["command", "buffered", "sync"])
for (const [option, value, width, pixels] of [
    ["-resize", "1x1!", 1, [255, 0, 0, 255]],
    ["-rotate", "180", 2, [255, 0, 0, 255, 255, 0, 0, 255]],
    ["-geometry", "+1+0", 2, [0, 0, 255, 255, 255, 0, 0, 255]],
] as const)
it(`${route}: composite consumes ${option} ${value} as an option`, async () => {
    const overlay = await sharp({ create: { width: 2, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    const base = await sharp({ create: { width: 2, height: 1, channels: 4, background: "blue" } }).png().toBuffer();
    const files = new Map([["/a.png", overlay], ["/b.png", base]]);
    const args = [option, value, "/a.png", "/b.png", "/out.png"];
    let output: Uint8Array;
    if (route === "command") {
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["composite", ...args]).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = await fs.readFile("/out.png");
    } else {
        const result = route === "sync" ? runCompositeCliSync(args, files) : await runCompositeCli(args, files);
        expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = files.get("/out.png")!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([width, 1]);
    expect([...image.data]).toEqual(pixels);
});
