import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gravity positions the extra minimum-size margin.
const gravities = [
    { gravity: undefined, left: 2, top: 1 },
    { gravity: "None", left: 2, top: 1 },
    { gravity: "NorthWest", left: 0, top: 0 },
    { gravity: "North", left: 1, top: 0 },
    { gravity: "NorthEast", left: 2, top: 0 },
    { gravity: "West", left: 0, top: 1 },
    { gravity: "Center", left: 1, top: 1 },
    { gravity: "East", left: 2, top: 1 },
    { gravity: "SouthWest", left: 0, top: 1 },
    { gravity: "South", left: 1, top: 1 },
    { gravity: "SouthEast", left: 2, top: 1 },
];
const cases = [
    ...["gravity", "option:gravity"].flatMap(key => [
        { gravity: "Center", key, minimum: "3x2", width: 3, height: 2, left: 1, top: 1 },
        { gravity: "NorthWest", key, minimum: "3x2", width: 3, height: 2, left: 0, top: 0 },
    ]),
    { gravity: "Center", key: "artifact:gravity", minimum: "3x2", width: 3, height: 2, left: 2, top: 1 },
    ...gravities.map(test => ({ ...test, minimum: "3x2", width: 3, height: 2 })),
    ...gravities.map(test => ({ ...test, minimum: undefined, width: 1, height: 1, left: 2, top: 1 })),
    { gravity: "Center", minimum: "3x2", width: 3, height: 2, left: 1, top: 1, page: true },
    { gravity: "NorthWest", minimum: "3x2", width: 3, height: 2, left: 0, top: 0, page: true },
    { gravity: "Center", minimum: "3x2", width: 3, height: 2, left: 1, top: 1, background: "white" },
    { gravity: "NorthWest", minimum: "3x2", width: 3, height: 2, left: 0, top: 0, background: "#ffffff80" },
    { gravity: "Center", minimum: "3x2", width: 3, height: 2, left: 1, top: 1, percent: true },
    { gravity: "NorthWest", minimum: "3x2", width: 3, height: 2, left: 0, top: 0, percent: true, background: "#ffffff80" },
    { gravity: "Center", minimum: "4x3", width: 4, height: 3, left: 1, top: 0 },
    { gravity: "NorthWest", minimum: "4x3", width: 4, height: 3, left: 0, top: 0 },
    { gravity: "SouthEast", minimum: "4x3", width: 4, height: 3, left: 1, top: 0 },
    { gravity: "Center", minimum: "20x20", width: 5, height: 3, left: 0, top: 0 },
    { gravity: "Center", minimum: "3", width: 3, height: 1, left: 1, top: 1 },
    { gravity: "NorthWest", minimum: "x2", width: 1, height: 2, left: 2, top: 0 },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: trims minimum $minimum at $gravity ($key, $background, page=$page, percent=$percent)`, async test => {
        const background = "background" in test ? test.background : undefined;
        const page = "page" in test && test.page;
        const percent = "percent" in test && test.percent;
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = [
            "-size", "5x3", `xc:${background ?? "none"}`, "-fill", "red", "-draw", "point 2,1",
            ...(test.gravity ? "key" in test && typeof test.key === "string" ? ["-set", test.key, test.gravity] : ["-gravity", test.gravity] : []),
            ...(page ? ["-repage", "11x9+3+4"] : []),
            ...(test.minimum ? ["-define", `trim:minSize=${test.minimum}`] : []),
            ...(percent ? ["-define", "trim:percent-background=50"] : []),
            "-trim", "-format", "%wx%h|%g", "-write", "info:/page", "PNG32:/out",
        ];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const geometry = mode === "command" || mode === "retained" ? await fs.readFile("/page") : files.get("/page")!;
        expect(new TextDecoder().decode(geometry)).toBe(`${test.width}x${test.height}|5x3+${test.left + (page ? 3 : 0)}+${test.top + (page ? 4 : 0)}`);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        expect([output.width, output.height]).toEqual([test.width, test.height]);
        const expected = [];
        for (let y = test.top; y < test.top + test.height; y++) for (let x = test.left; x < test.left + test.width; x++) {
            expected.push(...(x === 2 && y === 1 ? [255, 0, 0, 255]
                : background === "white" ? [255, 255, 255, 255]
                    : background === "#ffffff80" ? [255, 255, 255, 128] : [0, 0, 0, 0]));
        }
        expect(output.data).toEqual(new Uint8Array(expected));
    });
}
