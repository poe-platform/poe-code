import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full decoded grid from ImageMagick 7.1.2-31 Q16-HDRI.
const expected = [
    255,127,127,255, 191,191,127,255, 126,255,128,255,
    191,127,192,255, 191,191,159,255, 191,255,127,255,
    126,127,255,255, 191,191,192,255, 255,255,127,255
];
const twoFrames = [
    [255,84,84,255, 170,170,84,255, 82,255,85,255, 170,84,171,255, 170,170,128,255, 170,255,84,255, 82,84,255,255, 170,170,171,255, 255,255,84,255],
    [255,169,169,255, 213,213,170,255, 169,255,170,255, 213,169,213,255, 213,213,191,255, 213,255,170,255, 169,169,255,255, 213,213,213,255, 255,255,169,255]
];
for (const count of [1, 2])
for (const reverse of [false, true])
for (const mode of ["map", "sync", "command"])
it(`matches native unequal-size morph pixels: ${mode}, count=${count}, reverse=${reverse}`, async () => {
    const a = await sharp(Uint8Array.of(255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const b = await sharp(new Uint8Array(64).fill(255), { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    const files = new Map([["/a.png", a], ["/b.png", b]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(reverse ? ["/b.png", "/a.png"] : ["/a.png", "/b.png"]), "-morph", String(count), "/out-%d.png"];
    let stderr = "";
    const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "map" ? await runConvertCli(args, files) : await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const frames = [decodeImage(a), ...(count === 1 ? [expected] : twoFrames).map(data => ({ width: 3, height: 3, data })), decodeImage(b)];
    if (reverse) frames.reverse();
    for (let frame = 0; frame < frames.length; frame++) {
        const output = decodeImage(mode === "command" ? await fs.readFile(`/out-${frame}.png`) : files.get(`/out-${frame}.png`)!);
        expect([output.width, output.height]).toEqual([frames[frame]!.width, frames[frame]!.height]);
        expect([...output.data]).toEqual([...frames[frame]!.data]);
    }
    const names = mode === "command" ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
    expect(names.sort()).toEqual(["/a.png", "/b.png", ...frames.map((_, frame) => `/out-${frame}.png`)]);
});
