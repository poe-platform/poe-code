import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMogrifyCommand, runMogrifyCli, runMogrifyCliSync } from "./index.js";

for (const mode of ["magick", "mogrify", "retained", "buffered", "sync"] as const)
for (const scenario of ["reset", "explicit", "dotted", "unset", "missing", "trailing"] as const)
it(`resets only the mogrify output format (${mode}, ${scenario})`, async () => {
    const originals = new Map([
        ["a/x.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
        ["b/x.ppm", new TextEncoder().encode("P3\n1 1\n255\n0 0 255\n")],
        ["a/color.v1.ppm", new TextEncoder().encode("P3\n1 1\n255\n170 70 30\n")]
    ]);
    const files = new Map(originals);
    const fs = new MemoryFileSystem();
    for (const directory of ["a", "b", "dest"]) await fs.mkdir("/" + directory);
    for (const [path, bytes] of originals) await fs.writeFile("/" + path, bytes);
    const target = scenario === "dotted" ? "a/color.v1.ppm" : scenario === "missing" ? "b/missing.ppm" : "b/x.ppm";
    const args = ["-path", "dest", ...(scenario === "unset" ? [] : ["-format", "png", "a/x.ppm"]),
        ...(scenario === "explicit" ? ["-format", "ppm"] : ["+format"]), ...(scenario === "trailing" ? [] : [target])];
    let stdout = "", stderr = "";
    let exitCode: number;
    if (mode === "magick" || mode === "mogrify") {
        const command = mode === "magick" ? createMagickCommand() : createMogrifyCommand();
        const argumentValues = createCommandArguments(mode === "magick" ? ["mogrify", ...args] : args);
        ({ exitCode } = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }));
    } else {
        ({ exitCode, stdout, stderr } = mode === "sync" ? runMogrifyCliSync(args, files)
            : await runMogrifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" }));
    }
    expect({ exitCode, stdout, stderr }).toEqual({
        exitCode: scenario === "missing" ? 1 : 0, stdout: "",
        stderr: scenario === "missing" ? "mogrify: unable to open image 'b/missing.ppm': No such file or directory\n" : ""
    });
    const expected = new Map<string, number[]>();
    if (scenario !== "unset") expected.set("x.png", [255, 0, 0, 255]);
    if (scenario === "dotted") expected.set("color.v1.ppm", [170, 70, 30, 255]);
    else if (scenario !== "missing" && scenario !== "trailing") expected.set("x.ppm", [0, 0, 255, 255]);
    const buffered = mode === "buffered" || mode === "sync";
    const outputs = buffered ? [...files.keys()].filter(path => path.startsWith("dest/")).map(path => path.slice(5))
        : (await fs.readdir("/dest")).map(entry => entry.name);
    expect(outputs.sort()).toEqual([...expected.keys()].sort());
    for (const [name, pixels] of expected) {
        const bytes = buffered ? files.get("dest/" + name)! : await fs.readFile("/dest/" + name);
        expect(Array.from(decodeImage(bytes).data)).toEqual(pixels);
    }
    for (const [path, bytes] of originals) {
        expect(buffered ? files.get(path) : await fs.readFile("/" + path)).toEqual(bytes);
    }
});
