import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
it.each([
    ["Convolve", "3x3:1,0,0,0,0,0,0,0,0", 1, 1],
    ["Correlate", "3x3:1,0,0,0,0,0,0,0,0", 3, 3],
    ["Convolve", "3x3:0,0,0,0,1,0,0,0,0", 2, 2],
] as const)(`matches ImageMagick morphology orientation (${mode}): %s %s`, async (method, kernel, x, y) => {
    const pixels = new Uint8Array(5 * 5 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels[12 * 4] = 255;
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", method, kernel, "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const expected = new Uint8Array(pixels.length);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    expected[(y * 5 + x) * 4] = 255;
    expect(output.data).toEqual(expected);
});
