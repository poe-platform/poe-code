import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, identical bytes and argv.
it.each(["P2", "P3", "P5", "P6"].flatMap(magic => [
    { maxval: 7, sample: 1, expected: "3/0.1428571386" },
    { maxval: 65535, sample: 9362, expected: "16/0.142854962997" },
    { maxval: 2, sample: 1, expected: "16/0.5" },
    { maxval: 1023, sample: 1, expected: "10/0.000977517120205" },
    { maxval: 10, sample: 1, expected: "16/0.1" }
].map(test => ({ magic, ...test }))))("preserves $magic maxval=$maxval fractional FX values and effective depth", async ({ magic, maxval, sample, expected }) => {
    const samples = Array(magic === "P3" || magic === "P6" ? 3 : 1).fill(sample);
    const raster = Buffer.alloc(samples.length * (maxval > 255 ? 2 : 1));
    samples.forEach((value, index) => maxval > 255 ? raster.writeUInt16BE(value, index * 2) : raster[index] = value);
    const input = Buffer.concat([Buffer.from(`${magic}\n1 1\n${maxval}\n`),
        magic === "P2" || magic === "P3" ? Buffer.from(samples.join(" ") + "\n") : raster]);
    const format = "%[bit-depth]/%[fx:p{0,0}.r]";
    const identify = ["-precision", "12", "-format", format, "/in.pnm"];
    const convert = ["/in.pnm", "-precision", "12", "-format", format, "info:"];
    const files = new Map([["/in.pnm", input]]);
    expect(await runIdentifyCli(identify, files)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    expect(runMagickCliSync(convert, files)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    for (const argv of [["identify", ...identify], convert]) {
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    }
});
