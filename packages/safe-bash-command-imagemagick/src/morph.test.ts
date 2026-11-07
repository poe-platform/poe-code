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

for (const count of [0, 1, 2, 4])
for (const mode of ["map", "sync", "filesystem"])
it(`repeats a single morph source like native ImageMagick: ${mode}, count=${count}`, async () => {
    const input = await sharp(Uint8Array.of(255, 0, 0, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/red.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/red.png", input);
    const args = ["/red.png", "-morph", String(count), "+append", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([Math.max(1, count), 1]);
    expect([...output.data]).toEqual(Array.from({ length: Math.max(1, count) }, () => [255, 0, 0, 255]).flat());
});

for (const mode of ["map", "sync", "command"])
for (const resized of [false, true])
for (const alpha of [false, true])
for (const reverse of [false, true])
it(`preserves the first morph alpha unless both inputs have alpha: ${mode}, resized=${resized}, alpha=${alpha}, reverse=${reverse}`, async () => {
    const red = await sharp(Uint8Array.from(alpha ? [255, 0, 0, 64] : [255, 0, 0]), { raw: { width: 1, height: 1, channels: alpha ? 4 : 3 } }).png().toBuffer();
    const size = resized ? 3 : 1;
    const blue = await sharp(Uint8Array.from(Array.from({ length: size * size }, () => [0, 0, 255, 191]).flat()), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
    const files = new Map([["/red.png", red], ["/blue.png", blue]]), fs = new MemoryFileSystem();
    expect(decodeImage(red).hasAlpha).toBe(alpha);
    expect(decodeImage(blue).hasAlpha).toBe(true);
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(reverse ? ["/blue.png", "/red.png"] : ["/red.png", "/blue.png"]), "-morph", "1", "+append", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "map" ? await runConvertCli(args, files) : await createConvertCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
    });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    // Native ImageMagick: mixed alpha keeps the first input's alpha; two active channels interpolate.
    const middle = (reverse ? size : 1) * 4;
    expect([...output.data.slice(middle, middle + 4)]).toEqual([128, 0, 128, alpha ? 128 : reverse ? 191 : 255]);
    const first = reverse ? [0, 0, 255, 191] : [255, 0, 0, alpha ? 64 : 255];
    const last = reverse ? [255, 0, 0, alpha ? 64 : 255] : [0, 0, 255, 191];
    expect([...output.data.slice(0, 4)]).toEqual(first);
    expect([...output.data.slice((output.width - 1) * 4, output.width * 4)]).toEqual(last);
});

for (const mode of ["map", "sync", "filesystem"])
for (const alpha of [false, true])
for (const resized of alpha ? [false, true] : [false])
for (const channel of ["R", "G", "B", "A", "reset"])
it(`respects morph channels: ${mode}, resized=${resized}, channel=${channel}, alpha=${alpha}`, async () => {
    const red = await sharp(Uint8Array.from(alpha ? [255, 0, 0, 64] : [255, 0, 0]), { raw: { width: 1, height: 1, channels: alpha ? 4 : 3 } }).png().toBuffer();
    const size = resized ? 3 : 1;
    const blue = await sharp(Uint8Array.from(Array.from({ length: size * size }, () => alpha ? [0, 0, 255, 191] : [0, 0, 255]).flat()), { raw: { width: size, height: size, channels: alpha ? 4 : 3 } }).png().toBuffer();
    const files = new Map([["/red.png", red], ["/blue.png", blue]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/red.png", "/blue.png", "-channel", channel === "reset" ? "R" : channel, ...(channel === "reset" ? ["+channel"] : []), "-morph", "1", "/out-%d.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const middle = [channel === "R" || channel === "reset" ? 128 : 0, 0, channel === "B" || channel === "reset" ? 128 : 255, !alpha ? 255 : channel === "A" || channel === "reset" ? 128 : 191];
    for (const [frame, pixel, width] of [[0, [255, 0, 0, alpha ? 64 : 255], 1], [1, middle, resized ? 2 : 1], [2, [0, 0, 255, alpha ? 191 : 255], size]] as const) {
        const output = decodeImage(mode === "filesystem" ? await fs.readFile(`/out-${frame}.png`) : files.get(`/out-${frame}.png`)!);
        expect([output.width, output.height]).toEqual([width, width]);
        expect([...output.data]).toEqual(Array.from({ length: width * width }, () => pixel).flat());
    }
});
