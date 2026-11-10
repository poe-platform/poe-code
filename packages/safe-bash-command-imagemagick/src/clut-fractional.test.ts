import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with byte-output and nearest-neighbor controls.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const { interpolation, depth, expected } of [
    { interpolation: "bilinear", depth: "16", expected: "4590aed788d0143f432e787f0505ebeb98a4" },
    { interpolation: "average", depth: "16", expected: "579754d56b2b3bbc7c3c6b2b050554d56b2b" },
    { interpolation: "bilinear", depth: "8", expected: "45ae8814437805eb98" },
    { interpolation: "nearest-neighbor", depth: "16", expected: "3f3febebffff0505030317170505ebebffff" }
])
it(`preserves fractional CLUT samples (${mode}, ${interpolation}, depth=${depth})`, async () => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/out", Buffer.from("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", "/lut.ppm", "-interpolate", interpolation, "-clut", "-endian", "MSB", "-depth", depth, "rgb:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

for (const selection of [["-region", "600x1"], ["-write-mask", "xc:black"]])
it(`retains fractional CLUT samples across storage pages with ${selection[0]}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/a.ppm", Buffer.from(`P3\n600 1\n255\n${"13 31 79 235 153 61 255 0 127 ".repeat(200)}\n`));
    await filesystem.writeFile("/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n"));
    const result = await runConvertCli(["/a.ppm", ...selection, "/lut.ppm", "-clut", "+region", "+write-mask", "-endian", "MSB", "-depth", "16", "rgb:/out"], { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Buffer.from(await filesystem.readFile("/out")).toString("hex")).toBe("4590aed788d0143f432e787f0505ebeb98a4".repeat(200));
});
