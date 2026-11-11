import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(
    [1, 2, 3, 1, 4, 2, 1, 4, 4, 3, 3, 2, 1, 3, 4].flatMap(i => [i * 40, i * 20, 255 - i * 30]))]);
// ImageMagick 7.1.2-35 Q16-HDRI, -noise geometry -depth 8 rgb:-.
const fixtures = [
    { geometry: "3", expected: "5028c35028c35028c3783ca5783ca55028c35028c35028c3783ca5783ca55028c35028c35028c3783ca5783ca5" },
    { geometry: "3x1", expected: "5028c35028c35028c3783ca52814e12814e15028c32814e1783ca5a050875028c35028c35028c3783ca5783ca5" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const options of [[], ["-quiet"], ["-quiet", "+quiet"], ["-regard-warnings"]])
for (const shorthand of [true, false])
it.each(fixtures)(`${mode}: NonPeak shorthand=${shorthand}, options=${options} ($geometry)`, async ({ geometry, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const argv = [...options, "/in.ppm", ...(shorthand ? ["-noise"] : ["-statistic", "NonPeak"]), geometry, "-depth", "8", "rgb:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "", exitCode: number;
    if (mode === "command") {
        const argumentValues = createCommandArguments(argv);
        ({ exitCode } = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }));
    } else {
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        ({ exitCode, stderr } = result);
        stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
    }
    expect.soft(exitCode).toBe(0);
    expect.soft(stderr).toBe(shorthand && (options.length !== 1 || options[0] !== "-quiet")
        ? `magick: option has been replaced '-noise', use "-statistic NonPeak" at CLI arg ${options.length + 2}\n` : "");
    expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
});

for (const mode of ["buffered", "retained", "sync"] as const)
it.each(fixtures)(`${mode}: mogrify consumes the noise geometry ($geometry)`, async ({ geometry, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const argv = ["-noise", geometry, "-depth", "8", "/in.ppm"];
    const result = mode === "sync" ? runMogrifyCliSync(argv, files)
        : await runMogrifyCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stdout: "" });
    expect(result.stderr).toContain('option has been replaced \'-noise\', use "-statistic NonPeak"');
    const output = decodeImage(mode === "retained" ? await fs.readFile("/in.ppm") : files.get("/in.ppm")!);
    expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(expected);
});
