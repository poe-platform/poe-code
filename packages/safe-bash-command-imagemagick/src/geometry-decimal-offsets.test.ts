import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    { geometry: "2x1+.8+1", x: 0.8, y: 1 },
    { geometry: "2x1+1+.8", x: 1, y: 0.8 },
    { geometry: "2x1+1.+.8", x: 1, y: 0.8 },
    { geometry: "2x1+.8+1.", x: 0.8, y: 1 },
    { geometry: "2x1-.8-1.", x: -0.8, y: -1 },
    { geometry: "2x1-1.-.8", x: -1, y: -0.8 },
    { geometry: "2x1+.8e+1-1.e-1", x: 8, y: -0.1 },
    { geometry: "2x1+.8+1.+.2", x: 0.8, y: 1 },
])("preserves decimal rectangle offsets before pixel conversion: $geometry", ({ geometry, x, y }) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ width: 2, height: 1, x, y, hasOffset: true, hasYOffset: true });
});

// ImageMagick 7.1.2-35 Q16-HDRI outputs for a red pixel at (0, 0) on a 3x2 black canvas.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ...[
            { geometry: "+.8+1", pixel: 3 },
            { geometry: "+0.8+1", pixel: 3 },
            { geometry: "+1+1.", pixel: 4 },
            { geometry: "+1+1.0", pixel: 4 },
            { geometry: "+1.+.8", pixel: 1 },
            { geometry: "+1+.8", pixel: 1 },
            { geometry: "-.8+1.", pixel: 3 },
            { geometry: "-1.-.8", pixel: 2 },
        ].map(({ geometry, pixel }) => ({
            operation: "-roll", geometry, raw: true,
            expected: "000000".repeat(pixel) + "ff0000" + "000000".repeat(5 - pixel),
        })),
        ...["2x1+1+.8", "2x1+1+0.8", "2x1+1.+.8"].flatMap(geometry => [
            { operation: "-crop", geometry, raw: false, expected: "2x1,3x2+1+0;" },
            { operation: "-chop", geometry, raw: false, expected: "1x1,1x1+0+0;" },
            { operation: "-splice", geometry, raw: false, expected: "5x3,5x3+0+0;" },
            { operation: "-extent", geometry, raw: false, expected: "2x1,2x1+0+0;" },
            { operation: "-repage", geometry, raw: false, expected: "3x2,2x1+1+0;" },
            { operation: "-region", geometry, raw: true, expected: "ff0000ffffffffffff000000000000000000" },
        ]),
        { operation: "-crop", geometry: "2x1+.8+1.", raw: false, expected: "2x1,3x2+0+1;" },
    ])(`matches pixels and frame geometry for $operation $geometry (${mode})`, async ({ operation, geometry, raw, expected }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "3x2", "xc:black", "-fill", "red", "-draw", "point 0,0", operation, geometry,
            ...(operation === "-region" ? ["-negate", "+region"] : []),
            ...(raw ? ["-depth", "8", "rgb:/out"] : ["-format", "%wx%h,%g;", "info:/out"])];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(raw ? "hex" : "utf8")).toBe(expected);
    });
}
