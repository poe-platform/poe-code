import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves Gray and its alpha plane.
for (const mode of ["map", "sync", "command"])
for (const direction of ["-append", "+append"])
for (const single of [false, true])
for (const separate of [false, true])
it(`preserves grayscale append channels (${mode}, ${direction}, single=${single}, separate=${separate})`, async () => {
    const argv = [
        ...(separate ? [] : ["-size", "2x1"]), "xc:#2060b080",
        ...(single ? [] : [...(separate ? [] : ["-size", "1x2"]), "xc:#c04020ed"]),
        "-colorspace", "Gray", direction,
        ...(separate ? ["-separate", "-format", "%wx%h;"] : ["-format", "%[colorspace] %[channels]"]), "info:/out",
    ];
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const size = single ? "1x1" : direction === "-append" ? "1x2" : "2x1";
    expect(new TextDecoder().decode(mode === "command" ? await fs.readFile("/out") : files.get("/out")))
        .toBe(separate ? `${size};${size};` : "Gray graya 2.0");
});

for (const retained of [false, true])
it.each([
    { options: ["-alpha", "off"], expected: "Gray gray  1.0" },
    { options: ["-background", "red"], expected: "sRGB srgba 4.0" },
    { options: ["xc:red"], expected: "sRGB srgba 4.0" },
])(`preserves append channel promotion (retained=${retained}): $options`, async ({ options, expected }) => {
    const argv = ["xc:#2060b080", "xc:#c04020ed", "-colorspace", "Gray", ...options,
        "-append", "-format", "%[colorspace] %[channels]", "info:/out"];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    expect(await runMagickCli(argv, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    expect(new TextDecoder().decode(retained ? await fs.readFile("/out") : files.get("/out"))).toBe(expected);
});
