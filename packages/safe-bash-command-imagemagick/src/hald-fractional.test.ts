import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, using the same 8-bit PPM inputs.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    { interpolation: [], depth: "16", expected: "c6336acf408f936cb891407c425a677f8ca4" },
    { interpolation: ["-interpolate", "bilinear"], depth: "16", expected: "c6336acf408f936cb891407c425a677f8ca4" },
    { interpolation: ["-interpolate", "integer"], depth: "16", expected: "dab368192f8465838aa8afcd425a677f8ca4" },
    { interpolation: ["-interpolate", "average"], depth: "16", expected: "968c6cf07aa67f8496256301760e9b337f56" },
    { interpolation: [], depth: "8", expected: "c56a4093b84042678c" },
    { interpolation: ["-interpolate", "nearest-neighbor"], depth: "16", expected: "fdfd22224747c2c2e7e70c0c4a4a6f6f9494" },
])(`${mode}: retains fractional Hald colors, $interpolation, depth=$depth`, async ({ interpolation, depth, expected }) => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Buffer.from(Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256))])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/a.ppm", "/h.ppm", ...interpolation, "-hald-clut", "-endian", "MSB", "-depth", depth, "rgb:/out"];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
it(`preserves Hald colors and masked pixels across storage pages, retained=${retained}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "513x2", "xc:red", "-write-mask", "xc:white", "xc:blue", "-hald-clut", "+write-mask", "-depth", "16", "-endian", "MSB", "rgb:/out"];
    expect(await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(output).toEqual(Uint8Array.from({ length: 513 * 2 * 6 }, (_, i) => i % 6 < 2 ? 255 : 0));
});
