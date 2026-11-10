import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const fine = [10000, 22222, 40100, 10100, 22181, 39998, 9987, 22231, 40162, 10087, 22134, 40001, 10050, 22092, 40199];
const full = [3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240].map(value => value * 257);
const identity = "271056ce9ca4ffff277456a59c3effff270356d79ce2ffff276756769c41ffff2742564c9d07ffff";
// Exact decoded RGBA16 from ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures = [
    ...["Minimum", "Mean", "Mode", "Nonpeak", "RootMeanSquare"].map(method => ({ name: `${method} identity`, samples: fine, args: ["-statistic", method, "1x1"], expected: identity })),
    ...["Gradient", "StandardDeviation"].map(method => ({ name: `${method} identity window`, samples: fine, args: ["-statistic", method, "1x1"], expected: "000000000000ffff".repeat(5) })),
    { name: "morphology Edge", samples: fine, args: ["-morphology", "Edge", "Rectangle:3x1"], expected: "006400290066ffff0071003200a4ffff0071006100a4ffff0064008b00c6ffff0025002a00c6ffff" },
    { name: "Gradient window", samples: fine, args: ["-statistic", "Gradient", "3x1"], expected: "006400290066ffff0071003200a4ffff0071006100a4ffff0064008b00c6ffff0025002a00c6ffff" },
    { name: "Maximum identity", samples: fine, args: ["-statistic", "Maximum", "1x1"], expected: identity },
    { name: "Median identity", samples: fine, args: ["-statistic", "Median", "1x1"], expected: identity },
    { name: "Minimum window", samples: fine, args: ["-statistic", "Minimum", "3x1"], expected: "271056a59c3effff270356a59c3effff270356769c3effff2703564c9c41ffff2742564c9c41ffff" },
    { name: "Mode window", samples: fine, args: ["-statistic", "Mode", "3x1"], expected: "271056ce9ca4ffff270356a59c3effff270356769c3effff2703564c9c41ffff2742564c9d07ffff" },
    { name: "plain PNG64 control", samples: fine, args: [], expected: identity },
    { name: "byte-aligned control", samples: full, args: ["-statistic", "Maximum", "1x1"], expected: "03037070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const fixture of fixtures)
it(`${mode}: preserves Q16 statistic samples: ${fixture.name}`, async () => {
    const input = Uint8Array.from([
        ...new TextEncoder().encode("P6\n5 1\n65535\n"),
        ...fixture.samples.flatMap(value => [value >> 8, value & 255]),
    ]);
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/in.ppm", input], ["/out.png", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/out.png", keep);
    const args = ["/in.ppm", ...fixture.args, "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([5, 1]);
    expect(output.data16).toBeDefined();
    expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(fixture.expected);
});

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const channel of ["R", "A"])
it(`${mode}: preserves selected and untouched Q16 channels across chunks (${channel})`, async () => {
    const width = 1025, height = 2;
    const samples = Uint16Array.from(Array.from({ length: width * height }, (_, pixel) => {
        const x = pixel % width, value = pixel < width ? x : width - 1 - x;
        return [10000 + value, 22222, 40000 - value, 30000 + value];
    }).flat());
    const input = encodeImage({ width, height, data16: samples, data: Uint8Array.from(samples, value => Math.round(value / 257)),
        format: "png", space: "srgb", channels: 4, hasAlpha: true, depth: "ushort", density: 72 }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-channel", channel, "-statistic", "Maximum", "3x1", "+channel", "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const selected = channel === "R" ? 0 : 3;
    const expected = Uint16Array.from(samples, (value, index) => index % 4 === selected ? Math.min(value + 1, (channel === "R" ? 10000 : 30000) + width - 1) : value);
    expect(output.data16).toEqual(expected);
});
