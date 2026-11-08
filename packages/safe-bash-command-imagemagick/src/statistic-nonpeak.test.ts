import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// Expected bytes verified with ImageMagick 7.1.2-31, including replicated edges.
const fixtures = [
    { name: "gradient", width: 3, geometry: "3x3", values: [0, 0, 0, 128, 128, 128, 255, 255, 255], expected: Array(9).fill(128) },
    { name: "two distinct values", width: 3, geometry: "3x3", values: [128, 128, 128, 128, 128, 128, 128, 128, 255], expected: [128, 128, 128, 128, 255, 255, 128, 255, 255] },
    { name: "minimum median", width: 3, geometry: "3x1", values: [0, 0, 80], expected: [0, 80, 0] },
    { name: "maximum median", width: 3, geometry: "3x1", values: [80, 255, 255], expected: [255, 80, 255] },
    { name: "interior median", width: 5, geometry: "5x1", values: [0, 40, 80, 120, 255], expected: [40, 40, 80, 120, 120] },
    { name: "constant", width: 3, geometry: "3x3", values: [80, 80, 80], expected: [80, 80, 80] },
    { name: "even window", width: 3, geometry: "2x1", values: [0, 100, 200], expected: [0, 0, 100] },
    { name: "identity window", width: 3, geometry: "1x1", values: [0, 100, 200], expected: [0, 100, 200] },
];
for (const mode of ["command", "buffered", "retained"] as const)
for (const alpha of [false, true])
for (const fixture of fixtures)
it(`computes NonPeak: ${fixture.name} (${mode}, alpha=${alpha})`, async () => {
    const pixels = new Uint8Array(fixture.values.flatMap(value => alpha ? [value, value, value, value] : [value, value, value]));
    const image = sharp(pixels, { raw: { width: fixture.width, height: fixture.values.length / fixture.width, channels: alpha ? 4 : 3 } });
    const input = await (alpha ? image : image.removeAlpha()).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-statistic", "NonPeak", fixture.geometry, "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([...output.data]).toEqual(fixture.expected.flatMap(value => [value, value, value, alpha ? value : 255]));
});
