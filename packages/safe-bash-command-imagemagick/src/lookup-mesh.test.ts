import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "command"])
for (const [operation, interpolation, expected] of [
    ["-clut", "mesh", "45aabf164b9805eb99"],
    ["-hald-clut", "mesh", "c56a4093b84042678c"],
    ["-clut", "bilinear", "45ae8814437805eb98"],
    ["-hald-clut", "bilinear", "c56a4093b84042678c"],
]) it(`${mode}: ${operation} ${interpolation} matches native lookup bytes`, async () => {
    // ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Buffer.from(Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256))])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", operation === "-clut" ? "/lut.ppm" : "/h.ppm", "-interpolate", interpolation!, operation!, "-endian", "MSB", "-depth", "8", "rgb:/out"];
    let stderr = "";
    const result = mode === "map" ? await runConvertCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(mode === "map" ? result : { ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Buffer.from(mode === "map" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
});
