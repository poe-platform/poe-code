import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
    { options: ["-format", "FIRST;", "a.ppm", "+format", "b.ppm", "-format", "LAST;", "a.ppm"], formatted: "FIRST;LAST;", descriptions: ["b.ppm PPM 2x1 "] },
    { options: ["-format", "%f:%wx%h;", "a.ppm", "+format", "b.ppm"], formatted: "a.ppm:1x1;", descriptions: ["b.ppm PPM 2x1 "] },
    { options: ["-format", "FIRST;", "a.ppm", "-format", "LAST;", "b.ppm"], formatted: "FIRST;LAST;", descriptions: [] },
    { options: ["+format", "a.ppm"], formatted: "", descriptions: ["a.ppm PPM 1x1 "] },
    { options: ["-format", "one;", "a.ppm", "+format"], formatted: "one;", descriptions: [] },
    { options: ["-format", "", "a.ppm", "+format", "b.ppm"], formatted: "", descriptions: ["b.ppm PPM 2x1 "] },
    { options: ["-format", "one;", "a.ppm", "+format", "b.ppm", "a.ppm", "-format", "two;", "a.ppm"], formatted: "one;two;", descriptions: ["b.ppm PPM 2x1 ", "a.ppm PPM 1x1 "] },
    { options: ["-format", "one;", "a.ppm", "+format", "missing.ppm", "b.ppm", "-format", "two;", "a.ppm"], formatted: "one;two;", descriptions: ["b.ppm PPM 2x1 "] }
])(`identify emits default descriptions before formatted output (${mode}): $options`, async ({ options, formatted, descriptions }) => {
    const files = new Map([
        ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
        ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    let result;
    if (mode === "sync") result = runIdentifyCliSync(options, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(options, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...options]);
        let stdout = "", stderr = "";
        const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
    }
    expect(result).toMatchObject(options.includes("missing.ppm")
        ? { exitCode: 1, stderr: "identify: unable to open image 'missing.ppm': No such file or directory\n" }
        : { exitCode: 0, stderr: "" });
    const lines = result.stdout.split("\n");
    expect(lines).toHaveLength(descriptions.length + 1);
    for (const [index, description] of descriptions.entries()) expect(lines[index]!.startsWith(description)).toBe(true);
    expect(lines.at(-1)).toBe(formatted);
});

it("preserves the input format when identify expands multiple frames", async () => {
    const files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "3x2", "xc:red", "xc:blue", "movie.tiff"], files)).toMatchObject({ exitCode: 0 });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/movie.tiff", files.get("movie.tiff")!);
    for (const input of [files, { filesystem: fs, cwd: "/" }]) {
        const result = await runIdentifyCli(["-format", "one;", "movie.tiff", "+format", "movie.tiff"], input);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout.split("\n")).toHaveLength(3);
        expect(result.stdout.split("\n").at(-1)).toBe("one;one;");
        expect(result.stdout).toContain("movie.tiff[0] TIFF 3x2 ");
        expect(result.stdout).toContain("movie.tiff[1] TIFF 3x2 ");
    }
});
