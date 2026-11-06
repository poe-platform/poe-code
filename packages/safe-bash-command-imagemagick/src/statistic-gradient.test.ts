import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const channels of [3, 4] as const)
for (const impulse of [false, true])
it(`computes Gradient without activating alpha (${mode}, channels=${channels}, impulse=${impulse})`, async () => {
    const pixels = new Uint8Array(Array.from({ length: 9 }, (_, i) => {
        const rgb = impulse ? (i === 4 ? [200, 100, 50] : [20, 30, 40]) : [255, 0, 0];
        return channels === 4 ? [...rgb, 255] : rgb;
    }).flat());
    const input = await sharp(pixels, { raw: { width: 3, height: 3, channels } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-statistic", "Gradient", "3x3", "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    // Native ImageMagick subtracts active alpha, but keeps RGB images opaque.
    const rgb = impulse ? [180, 70, 10] : [0, 0, 0];
    expect([...output.data]).toEqual(Array.from({ length: 9 }, () => [...rgb, channels === 3 ? 255 : 0]).flat());
});
