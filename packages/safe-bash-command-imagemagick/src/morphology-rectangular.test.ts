import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// Expected pixel positions checked against native ImageMagick 7.1.2.
for (const mode of ["command", "buffered", "retained"] as const)
for (const method of ["Convolve", "Correlate"] as const)
for (const [kernel, dx, dy] of [
    ["3x1:1,0,0", 1, 0],
    ["2x1:1,0", 0, 0],
    ["1x2:1,0", 0, 0],
    ["1x3:1,0,0", 0, 1],
    ["3x1+0+0:1,0,0", 0, 0],
    ["1x3+0+0:1,0,0", 0, 0],
    ["3x3:0,0,0,0,1,0,0,0,0", 0, 0],
] as const)
it(`preserves ${kernel} dimensions and origin for ${method} (${mode})`, async () => {
    const pixels = new Uint8Array(100);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 0, 0, 255], 48);
    const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
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
    const direction = method === "Correlate" ? 1 : -1;
    pixels[48] = 0;
    pixels[((2 + direction * dy) * 5 + 2 + direction * dx) * 4] = 255;
    expect([...output.data]).toEqual([...pixels]);
});
