import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a smaller mask selects only its overlap.
const first = ["(", "in.ppm", "-read-mask", "xc:white", ")"];
const second = ["(", "in.ppm", "-crop", "1x1+1+0", "+repage", "-negate", ")"];
const morph = ["-morph", "1", "-delete", "0,2"];
const cases = [
    { name: "unchanged mask", args: ["in.ppm", "-read-mask", "xc:white"], expected: "0.027451" },
    { name: "unchanged dimensions", args: ["in.ppm", "-read-mask", "xc:white", "-resize", "3x2!"], expected: "0.027451" },
    { name: "resized mask", args: ["in.ppm", "-read-mask", "xc:white", "-resize", "2x2!"], expected: "0" },
    { name: "sampled mask", args: ["in.ppm", "-read-mask", "xc:white", "-sample", "2x2!"], expected: "0.027451" },
    { name: "scaled mask", args: ["in.ppm", "-read-mask", "xc:white", "-scale", "2x2!"], expected: "0.0784314" },
    { name: "cleared resized mask", args: ["in.ppm", "-read-mask", "xc:white", "-resize", "2x2!", "+read-mask"], expected: "0.409804" },
    { name: "full raster mask", args: ["(", "-size", "3x2", "xc:black", "-fill", "white", "-draw", "point 0,0", "-write", "mpr:mask", "+delete", ")", "in.ppm", "-read-mask", "mpr:mask", "-resize", "2x2!"], expected: "0" },
    { name: "first morph input mask", args: ["-respect-parentheses", ...first, ...second, ...morph], expected: "0" },
    { name: "full raster morph mask", args: ["-respect-parentheses", "(", "-size", "3x2", "xc:black", "-fill", "white", "-draw", "point 0,0", "-write", "mpr:mask", "+delete", ")", "(", "in.ppm", "-read-mask", "mpr:mask", ")", ...second, ...morph], expected: "0" },
    { name: "second morph input mask", args: ["-respect-parentheses", "(", "in.ppm", ")", ...second.slice(0, -1), "-read-mask", "xc:white", ")", ...morph], expected: "0.614706" },
    { name: "cleared morph mask", args: ["-respect-parentheses", ...first, ...second, ...morph, "+read-mask"], expected: "0.614706" }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`${mode}: resamples a smaller read mask with the image ($name)`, async ({ args, expected }) => {
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 13 + 7) % 256))]);
        const files = new Map([["in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = [...args, "-format", "%[fx:mean.r]", "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
