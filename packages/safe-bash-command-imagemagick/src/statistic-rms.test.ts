import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

// RMS fixtures cover edge replication, rounding, and even window alignment.
const fixtures = [
    { name: "center impulse", width: 3, geometry: "3x3", values: [0, 0, 0, 0, 255, 0, 0, 0, 0], expected: Array<number>(9).fill(85) },
    { name: "edge impulse", width: 3, geometry: "3x1", values: [255, 0, 0], expected: [208, 147, 0] },
    { name: "even window", width: 3, geometry: "2x1", values: [0, 100, 200], expected: [0, 71, 158] },
    { name: "identity window", width: 3, geometry: "1x1", values: [0, 100, 200], expected: [0, 100, 200] },
];
for (const statistic of ["RootMeanSquare", "RMS"])
for (const mode of ["command", "buffered", "retained"] as const)
for (const fixture of fixtures)
it(`computes ${statistic}: ${fixture.name} (${mode})`, async () => {
    const pixels = new Uint8Array(fixture.values.flatMap(value => [value, value, value, 255]));
    const input = await sharp(pixels, { raw: { width: fixture.width, height: fixture.values.length / fixture.width, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-statistic", statistic, fixture.geometry, "PNG32:/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([...output.data]).toEqual(fixture.expected.flatMap(value => [value, value, value, 255]));
});
