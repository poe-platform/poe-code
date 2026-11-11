import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// ImageMagick 7.1.2-35 scales neighborhood contrast to the quantum range.
// The decoded byte view contains the high byte of each Q16 PNG sample.
const fixtures = [
    { name: "center impulse", width: 3, geometry: "3x3", values: [0, 0, 0, 0, 255, 0, 0, 0, 0], expected: Array<number>(9).fill(255) },
    { name: "unequal nonzero values", width: 3, geometry: "3x1", values: [20, 80, 160], expected: [153, 199, 85] },
    { name: "black zero denominator", width: 3, geometry: "3x3", values: [0, 0, 0], expected: [0, 0, 0] },
    { name: "constant white", width: 3, geometry: "3x3", values: [255, 255, 255], expected: [0, 0, 0] },
    { name: "even window", width: 3, geometry: "2x1", values: [0, 100, 200], expected: [0, 255, 85] },
    { name: "identity window", width: 3, geometry: "1x1", values: [0, 100, 200], expected: [0, 0, 0] },
];
for (const mode of ["command", "buffered", "retained"] as const)
for (const alpha of [false, true])
for (const fixture of fixtures)
it(`computes Contrast: ${fixture.name} (${mode}, alpha=${alpha})`, async () => {
    const pixels = new Uint8Array(fixture.values.flatMap(value => alpha ? [value, value, value, 255] : [value, value, value]));
    const image = sharp(pixels, { raw: { width: fixture.width, height: fixture.values.length / fixture.width, channels: alpha ? 4 : 3 } });
    const input = await (alpha ? image : image.removeAlpha()).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-statistic", "Contrast", fixture.geometry, "PNG64:/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([...output.data]).toEqual(fixture.expected.flatMap(value => [value, value, value, alpha ? 0 : 255]));
});
