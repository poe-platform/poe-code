import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI sparse-color output, including its trailing separator.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "#4080c0", space: "HSL", precision: "3", expected: "hsl(210,50.4%,50.2%)" },
        { color: "#abcdef", space: "CMYK", precision: "3", expected: "cmyk(72.6,36.3,0,16)" },
        { color: "gray50", space: "RGB", precision: "3", expected: "rgb(21.2%,21.2%,21.2%)" },
        { color: "red", space: "Lab", precision: "3", expected: "cielab(53.2,80.1,67.2)" },
        { color: "lime", space: "HSL", expected: "hsl(120,100%,50%)" },
        { color: "black", space: "CMYK", expected: "cmyk(0,0,0,255)" },
        { color: "#abcdef", space: "CMYK", expected: "cmyk(72.5523,36.2762,0,16)" },
        { color: "gray50", space: "RGB", expected: "rgb(21.2231%,21.2231%,21.2231%)" },
        { color: "red", space: "Lab", expected: "cielab(53.2314,80.1144,67.22)" },
        { color: "gray50", space: "LinearGray", expected: "lineargray(21.2231%)" },
        { color: "lime", space: "sRGB", expected: "srgb(0,255,0)" },
        { color: "blue", space: "XYZ", expected: "xyz(18.0493,7.22005,95.0497)" },
        { color: "lime", space: "HSL", alpha: true, expected: "hsla(120,100%,50%,1)" },
        { color: "black", space: "CMYK", alpha: true, expected: "cmyka(0,0,0,255,1)" },
        { color: "gray50", space: "RGB", alpha: true, expected: "rgba(21.2231%,21.2231%,21.2231%,1)" }
    ])(`${mode}: writes $color in $space (alpha=$alpha)`, async ({ color, space, alpha, precision, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        for (const target of ["-", "out.dat"]) {
            const args = [`xc:${color}`, "-colorspace", space, ...(alpha ? ["-alpha", "on"] : []), ...(precision ? ["-precision", precision] : []), `sparse-color:${target}`];
            let result;
            if (mode === "command") {
                const argumentValues = createCommandArguments(args);
                let stdout = "", stderr = "";
                const status = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                result = { ...status, stdout, stderr };
            } else {
                result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            }
            expect(result).toEqual({ exitCode: 0, stdout: target === "-" ? `0,0,${expected} ` : "", stderr: "" });
            if (target !== "-") {
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile(`/${target}`) : files.get(target);
                expect(new TextDecoder().decode(bytes)).toBe(`0,0,${expected} `);
            }
        }
    });
}

for (const retained of [false, true]) {
    it.each([
        { space: "HSL", first: "hsl(0,100%,50%)", last: "hsl(240,100%,50%)" },
        { space: "CMYK", first: "cmyk(0,255,255,0)", last: "cmyk(255,255,0,0)" },
        { space: "RGB", first: "rgb(255,0,0)", last: "rgb(0,0,255)" },
        { space: "Lab", first: "cielab(53.2314,80.1144,67.22)", last: "cielab(32.3027,79.1923,-107.863)" }
    ])(`preserves $space samples across chunks and skips translucent pixels (retained=${retained})`, async ({ space, first, last }) => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        const result = await runMagickCli(["-size", "1x4097", "gradient:red-blue", "-colorspace", space, "sparse-color:-"], input);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const points = result.stdout.split(" ");
        expect(points).toHaveLength(4098);
        expect(points[0]).toBe(`0,0,${first}`);
        expect(points[4096]).toBe(`0,4096,${last}`);
        expect(points[4097]).toBe("");
        expect(await runMagickCli(["xc:#80ff0080", "-colorspace", space, "sparse-color:-"], input))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    });
}
