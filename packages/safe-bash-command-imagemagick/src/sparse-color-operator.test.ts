import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 5x1 xc:black
// -sparse-color METHOD '0,0 red 4,0 blue' -depth 8 rgb:out.raw.
const cases = [
    { method: "Voronoi", expected: "ff0000ff0000ff00000000ff0000ff" },
    { method: "Manhattan", expected: "ff0000ff0000ff00000000ff0000ff" },
    { method: "Shepards", expected: "f0000fe6001a8000801a00e60f00f0" },
    { method: "Inverse", expected: "cc0033bf00408000804000bf3300cc" },
    { method: "Barycentric", expected: "ff0000bf00408000804000bf0000ff" },
    { method: "Bilinear", expected: "ff0000bf00408000804000bf0000ff" },
    { method: "Bogus", error: "Bogus" },
    { method: "Voronoi", points: "", error: "control points" },
    { method: "Voronoi", points: "0,0 red 1,1", error: "control points" },
    { method: "Barycentric", points: "0,0 red 1,0 lime 2,0 blue", error: "Unsolvable Matrix" },
    { method: "Bilinear", size: "3x3", points: "0,0 red 2,0 lime 0,2 blue 2,2 white", expected: "ff000080800000ff0080008080808080ff800000ff8080ffffffff" },
    { method: "Barycentric", size: "3x3", points: "0,0 red 2,0 lime 0,2 blue", expected: "ff000080800000ff0080008000808000ff800000ff0080ff00ffff" },
    { method: "Barycentric", size: "3x3", points: "0,0 red 2,0 lime 0,2 blue 2,2 white", expected: "80000080800080ff0080008080808080ff808000ff8080ff80ffff" },
    { method: "Barycentric", size: "5x129", expected: "ff0000bf00408000804000bf0000ff".repeat(129) },
    { method: "Bilinear", size: "3x2", points: "1,1 #123456", expected: "123456".repeat(6) },
    { method: "Voronoi", size: "3x1", input: "xc:none", points: "0,0 rgba(255,0,0,0.25) 2,0 blue", format: "rgba", expected: "ff000040ff0000400000ffff" },
    { method: "Voronoi", size: "3x1", input: "xc:none", points: "0,0 red 2,0 blue", options: ["-channel", "R"], format: "rgba", expected: "ff000000ff00000000000000" },
    { method: "Shepards", options: ["-endian", "MSB"], depth: "16", expected: "f0f000000f0fe6660000199a800000008000199a0000e6660f0f0000f0f0" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`interpolates sparse color $method via ${mode} and preserves output on error`, async sample => {
        const { method, expected } = sample;
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map([["/out.raw", keep]]);
        await fs.writeFile("/out.raw", keep);
        const args = ["-size", sample.size ?? "5x1", sample.input ?? "xc:black", ...(sample.options ?? []), "-sparse-color", method, sample.points ?? "0,0 red 4,0 blue", "-depth", sample.depth ?? "8", `${sample.format ?? "rgb"}:/out.raw`];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        if (sample.error) {
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain(sample.error);
            expect(output).toEqual(keep);
        } else {
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}

for (const retained of [false, true])
it(`applies sparse-color through mogrify (retained=${retained})`, async () => {
    const input = new TextEncoder().encode("P3\n5 1\n255\n0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n");
    const filesystem = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await filesystem.writeFile("/in.ppm", input);
    const result = await runMogrifyCli(["-sparse-color", "Voronoi", "0,0 red 4,0 blue", "/in.ppm"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await filesystem.readFile("/in.ppm") : files.get("/in.ppm")!;
    const converted = new Map([["in.ppm", output]]);
    expect(runMagickCliSync(["in.ppm", "-depth", "8", "rgb:out"], converted).exitCode).toBe(0);
    expect(Buffer.from(converted.get("out")!).toString("hex")).toBe(cases[0]!.expected);
});
