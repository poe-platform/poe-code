import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const iterations of [0, 1, 2])
for (const channel of [undefined, "R"])
it.each([[false, "3x3:0,0,0,0,1,0,0,0,0"], [true, "3x3:0,0,0,0,1,0,0,0,0"], [true, "Edges"]] as const)(`removes only matched foreground (${mode}, iterations=${iterations}, channel=${channel}, block=%s, kernel=%s)`, async (block, kernel) => {
    const pixels = new Uint8Array(9 * 9 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    for (let y = block ? 2 : 4; y <= (block ? 6 : 4); y++)
        for (let x = block ? 2 : 4; x <= (block ? 6 : 4); x++)
            pixels.set([255, 255, 255, 255], (y * 9 + x) * 4);
    const input = await sharp(pixels, { raw: { width: 9, height: 9, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", ...(channel ? ["-channel", channel] : []), "-morphology", `Thinning:${iterations}`, kernel, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const expected = new Uint8Array(pixels.length);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    if (block) {
        expected.set(pixels);
        // Native ImageMagick applies the four Edges kernels sequentially.
        if (kernel === "Edges" && iterations > 0) for (const [x, y] of [[4, 2], [2, 3], [6, 3], [2, 4], [6, 4], [2, 5], [6, 5], [4, 6]])
            expected.set([0, 0, 0, 255], (y! * 9 + x!) * 4);
    }
    if (block && kernel === "Edges" && iterations === 2)
        for (const x of [3, 5]) expected.set([0, 0, 0, 255], (4 * 9 + x) * 4);
    if (iterations === 0) expected.set(pixels);
    if (channel) for (let i = 0; i < pixels.length; i++) if (i % 4 !== 0) expected[i] = pixels[i]!;
    expect(output.data).toEqual(expected);
});
