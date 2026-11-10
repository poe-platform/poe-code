import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for opaque RGB source and cube.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const selection of [[], ["-channel", "RGB"]])
it.each([
    { output: ["-format", "%[channels]", "info:/out"], expected: Buffer.from("srgba 4.0") },
    { output: ["-depth", "8", "rgba:/out"], expected: Buffer.from("c56a40ff93b840ff42678cff", "hex") },
    { output: ["-channel", "A", "-evaluate", "set", "50%", "+channel", "-depth", "8", "rgba:/out"], expected: Buffer.from("c56a408093b8408042678c80", "hex") },
    { output: ["-alpha", "off", "-format", "%[channels]", "info:/out"], expected: Buffer.from("srgb  3.0") },
])(`${mode}, selection=${selection}: Hald activates editable opaque alpha: $output`, async ({ output, expected }) => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Buffer.from(Array.from({ length: 192 }, (_, index) => (13 + 37 * index) % 256))])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/a.ppm", "/h.ppm", ...selection, "-hald-clut", ...output];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stdout).toBe("");
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    expect(Buffer.from(mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!)).toEqual(expected);
});
