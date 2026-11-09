import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

const pixels = [22, 82, 156, 5, 107, 223, 114, 19, 177, 110, 57, 18, 232, 221, 224, 2, 33, 78, 137, 210, 58, 159, 35, 164, 68, 225, 157, 103, 63, 37, 25, 27, 43, 73, 117];
const input = new TextEncoder().encode(`P2\n7 5\n255\n${pixels.join(" ")}\n`);

// ImageMagick 7.1.2-35 Q16, default edge virtual pixels, in row order.
const fixtures = [
    { statistic: "Maximum", geometry: "1x1", pixels: [22, 82, 156, 5, 107, 223, 114, 19, 177, 110, 57, 18, 232, 221, 224, 2, 33, 78, 137, 210, 58, 159, 35, 164, 68, 225, 157, 103, 63, 37, 25, 27, 43, 73, 117] },
    { statistic: "Maximum", geometry: "3x1", pixels: [82, 156, 156, 156, 223, 223, 223, 177, 177, 177, 110, 232, 232, 232, 224, 224, 78, 137, 210, 210, 210, 159, 164, 164, 225, 225, 225, 157, 63, 63, 37, 43, 73, 117, 117] },
    { statistic: "Maximum", geometry: "1x3", pixels: [22, 177, 156, 57, 107, 232, 221, 224, 177, 156, 78, 137, 232, 221, 224, 177, 164, 78, 225, 232, 221, 224, 37, 164, 78, 225, 210, 117, 159, 37, 164, 68, 225, 157, 117] },
    { statistic: "Maximum", geometry: "3x3", pixels: [177, 177, 177, 156, 232, 232, 232, 224, 224, 177, 156, 232, 232, 232, 224, 224, 177, 225, 232, 232, 232, 224, 224, 164, 225, 225, 225, 210, 159, 164, 164, 225, 225, 225, 157] },
    { statistic: "Maximum", geometry: "2x2", pixels: [22, 82, 156, 156, 107, 223, 223, 22, 177, 177, 156, 107, 232, 232, 224, 224, 177, 110, 137, 232, 232, 224, 224, 164, 164, 225, 225, 210, 159, 159, 164, 164, 225, 225, 157] },
    { statistic: "Maximum", geometry: "4x1", pixels: [82, 156, 156, 156, 223, 223, 223, 177, 177, 177, 177, 232, 232, 232, 224, 224, 224, 137, 210, 210, 210, 159, 164, 164, 225, 225, 225, 225, 63, 63, 63, 43, 73, 117, 117] },
    { statistic: "Maximum", geometry: "1x4", pixels: [22, 177, 156, 57, 107, 232, 221, 224, 177, 156, 78, 137, 232, 221, 224, 177, 164, 78, 225, 232, 221, 224, 177, 164, 78, 225, 232, 221, 224, 37, 164, 78, 225, 210, 117] },
    { statistic: "Maximum", geometry: "4x2", pixels: [82, 156, 156, 156, 223, 223, 223, 177, 177, 177, 177, 232, 232, 232, 224, 224, 224, 177, 232, 232, 232, 224, 224, 224, 225, 225, 225, 225, 159, 164, 164, 225, 225, 225, 225] },
    { statistic: "Maximum", geometry: "3", pixels: [177, 177, 177, 156, 232, 232, 232, 224, 224, 177, 156, 232, 232, 232, 224, 224, 177, 225, 232, 232, 232, 224, 224, 164, 225, 225, 225, 210, 159, 164, 164, 225, 225, 225, 157] },
    { statistic: "Maximum", geometry: "3x", pixels: [177, 177, 177, 156, 232, 232, 232, 224, 224, 177, 156, 232, 232, 232, 224, 224, 177, 225, 232, 232, 232, 224, 224, 164, 225, 225, 225, 210, 159, 164, 164, 225, 225, 225, 157] },
    { statistic: "Maximum", geometry: "3x3+1+1", pixels: [177, 177, 177, 156, 232, 232, 232, 224, 224, 177, 156, 232, 232, 232, 224, 224, 177, 225, 232, 232, 232, 224, 224, 164, 225, 225, 225, 210, 159, 164, 164, 225, 225, 225, 157] },
    { statistic: "Maximum", geometry: "50%", pixels: [232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232, 232] },
    { statistic: "Maximum", geometry: "3x3!", pixels: [177, 177, 177, 156, 232, 232, 232, 224, 224, 177, 156, 232, 232, 232, 224, 224, 177, 225, 232, 232, 232, 224, 224, 164, 225, 225, 225, 210, 159, 164, 164, 225, 225, 225, 157] },
    { statistic: "Maximum", geometry: "2.5x1", pixels: [22, 82, 156, 156, 107, 223, 223, 19, 177, 177, 110, 57, 232, 232, 224, 224, 33, 78, 137, 210, 210, 159, 159, 164, 164, 225, 225, 157, 63, 63, 37, 27, 43, 73, 117] },
    { statistic: "Maximum", geometry: "0x0", pixels: [22, 82, 156, 5, 107, 223, 114, 19, 177, 110, 57, 18, 232, 221, 224, 2, 33, 78, 137, 210, 58, 159, 35, 164, 68, 225, 157, 103, 63, 37, 25, 27, 43, 73, 117] },
    { statistic: "Median", geometry: "2x2", pixels: [22, 82, 156, 156, 107, 223, 223, 22, 82, 156, 110, 57, 223, 223, 224, 177, 110, 78, 78, 210, 221, 224, 159, 35, 78, 137, 210, 157, 159, 63, 37, 68, 68, 157, 117] },
    { statistic: "Mean", geometry: "2x2", pixels: [22, 52, 119, 81, 56, 165, 169, 21, 75, 131, 82, 47, 145, 198, 122, 106, 81, 70, 73, 149, 180, 192, 105, 59, 86, 127, 182, 132, 111, 74, 65, 71, 91, 125, 113] },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(fixtures)(`uses the requested $statistic $geometry window (${mode})`, async fixture => {
    const files = new Map([["/input.pgm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.pgm", input);
    const args = ["/input.pgm", "-statistic", fixture.statistic, fixture.geometry, "/out.pgm"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.pgm")! : await fs.readFile("/out.pgm"));
    expect([output.width, output.height]).toEqual([7, 5]);
    expect([...output.data]).toEqual(fixture.pixels.flatMap(value => [value, value, value, 255]));
});
