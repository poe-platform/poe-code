import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 RGB8 output for the same 4x2 PPM and 3x3 neighborhood.
const input = Buffer.from("50360a3420320a3235350a14e0141414e0e01414141414e0e0e06414149c9c9c2c2c2c", "hex");
const cases = [
    ["Median", "edge", "14e014 641414 2c1414 2c1414 64e0e0 9c9c9c 64142c 2c2c2c"],
    ["Median", "tile", "2c2c2c 9c9c9c 64142c 9c9c2c 141414 641414 2c1414 2c2c14"],
    ["Median", "black", "000000 141414 141414 000000 000000 141414 141414 000000"],
    ["Median", "white", "ffffff e0e0e0 9c2c9c ffffff ffffff e0e0e0 9c2c9c ffffff"],
    ["Minimum", "edge", "141414 141414 141414 141414 141414 141414 141414 141414"],
    ["Minimum", "tile", "141414 141414 141414 141414 141414 141414 141414 141414"],
    ["Minimum", "black", "000000 000000 000000 000000 000000 000000 000000 000000"],
    ["Minimum", "white", "141414 141414 141414 141414 141414 141414 141414 141414"],
    ["Maximum", "edge", "e0e0e0 e0e0e0 e09ce0 e09c9c e0e0e0 e0e0e0 e09ce0 e09c9c"],
    ["Maximum", "tile", "e0e0e0 e0e0e0 e09ce0 e0e0e0 e0e0e0 e0e0e0 e09ce0 e0e0e0"],
    ["Maximum", "black", "e0e0e0 e0e0e0 e09ce0 e09c9c e0e0e0 e0e0e0 e09ce0 e09c9c"],
    ["Maximum", "white", "ffffff ffffff ffffff ffffff ffffff ffffff ffffff ffffff"],
] as const;

for (const route of ["command", "buffered", "sync", "retained"] as const)
it.each(cases)(`honors %s with %s virtual pixels (${route})`, async (statistic, method, expected) => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-virtual-pixel", method, "-statistic", statistic, "3x3", "-virtual-pixel", "edge", "/out.ppm"];
    const stderr: string[] = [];
    const arguments_ = createCommandArguments(args);
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(String(chunk)); } },
    }) : route === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(route === "buffered" || route === "sync" ? files.get("/out.ppm")! : await fs.readFile("/out.ppm"));
    expect([output.width, output.height]).toEqual([4, 2]);
    expect([...output.data]).toEqual(expected.split(" ").flatMap(hex => [...Buffer.from(hex, "hex"), 255]));
});

for (const retained of [false, true]) {
    it(`resets virtual pixels to edge sampling (retained=${retained})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-virtual-pixel", "white", "+virtual-pixel", "-statistic", "Median", "3x3", "/out.ppm"];
        expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(retained ? await fs.readFile("/out.ppm") : files.get("/out.ppm")!);
        expect([...output.data]).toEqual(cases[0][2].split(" ").flatMap(hex => [...Buffer.from(hex, "hex"), 255]));
    });

    it(`uses background colors and preserves unselected channels (retained=${retained})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "1x1", "xc:#204060", "-background", "#aabbcc", "-virtual-pixel", "background", "-channel", "R",
            "-statistic", "Median", "3x3", "-background", "white", "/out.png"];
        expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data]).toEqual([0xaa, 0x40, 0x60, 255]);
    });

    it(`samples transparent padding for alpha statistics (retained=${retained})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "1x1", "xc:#204060", "-alpha", "set", "-virtual-pixel", "transparent", "-channel", "A",
            "-statistic", "Minimum", "3x3", "/out.png"];
        expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data]).toEqual([0x20, 0x40, 0x60, 0]);
    });
}
