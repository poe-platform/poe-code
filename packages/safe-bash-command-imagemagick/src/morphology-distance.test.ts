import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(["block", "dot", "edge", "white", "black"])(`${mode}: Manhattan distance intensities for %s`, async shape => {
    const pixels = new Uint8Array(9 * 9 * 4), expected = new Uint8Array(pixels.length);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const distance = shape === "white" ? Infinity : shape === "black" ? 0
            : shape === "edge" ? x : shape === "dot" ? Number(x === 4 && y === 4)
            : Math.max(0, Math.min(x - 1, 7 - x, y - 1, 7 - y));
        pixels.set([distance ? 255 : 0, distance ? 255 : 0, distance ? 255 : 0, 255], (y * 9 + x) * 4);
        // Native ImageMagick Q16: ! scales each step to QuantumRange / (64 + 1).
        const value = Math.min(255, Math.round(distance * 255 / 65));
        expected.set([value, value, value, 255], (y * 9 + x) * 4);
    }
    const input = await sharp(pixels, { raw: { width: 9, height: 9, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", "Distance", "Manhattan:1,64!", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    const decoded = decodeImage(output);
    expect(decoded.data16 ? Uint8Array.from(decoded.data16, value => Math.round(value / 257)) : decoded.data).toEqual(expected);
});

it.each(["Manhattan", "Manhattan:1,257", "Manhattan:1,64!"])("retains distances across chunk boundaries with %s", async kernel => {
    const width = 2053, pixels = new Uint8Array(width * 4).fill(255);
    pixels.set([0, 0, 0, 255], (width - 1) * 4);
    const input = await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file distance I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await runConvertCli(["/in.png", "-channel", "R", "-morphology", "Distance", kernel, "/out.png"], { filesystem, cwd: "/" })).exitCode).toBe(0);
    const decoded = decodeImage(await fs.readFile("/out.png"));
    const data = Uint8Array.from(decoded.data16!, value => Math.round(value / 257));
    const scale = kernel === "Manhattan" ? 100 / 257 : kernel.endsWith("!") ? 255 / 65 : 1;
    for (let x = 0; x < width; x++) {
        expect([...data.subarray(x * 4, x * 4 + 4)]).toEqual([
            Math.min(255, Math.round((width - x - 1) * scale)),
            pixels[x * 4 + 1], pixels[x * 4 + 2], 255
        ]);
    }
});

it.each(["Distance:0", "Distance:2"])("honors %s", async method => {
    const files = new Map<string, Uint8Array>();
    expect((await runConvertCli(["-size", "5x1", "xc:white", "-fill", "black", "-draw", "point 0,0", "-morphology", method, "Manhattan:1,257", "out.png"], files)).exitCode).toBe(0);
    const decoded = decodeImage(files.get("out.png")!);
    const data = decoded.data16 ? Uint8Array.from(decoded.data16, value => Math.round(value / 257)) : decoded.data;
    expect(Array.from({ length: 5 }, (_, x) => data[x * 4])).toEqual(method === "Distance:0" ? [0, 255, 255, 255, 255] : [0, 1, 2, 3, 4]);
});
