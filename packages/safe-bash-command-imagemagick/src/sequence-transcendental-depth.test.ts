import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw RGB references from ImageMagick 7.1.2-35 Q16-HDRI with 8-bit PPM inputs.
for (const mode of ["command", "retained", "map", "sync"] as const)
for (const depth of [8, 16])
it.each([
    { operation: "Sin", rgb16: "f93cf294d50fd63bcb3cd63b", rgb8: "f8f2d4d5cad5" },
    { operation: "Sine", rgb16: "f93cf294d50fd63bcb3cd63b", rgb8: "f8f2d4d5cad5" },
    { operation: "Cos", rgb16: "56f3b90d205ade971872de97", rgb8: "57b820de18de" },
    { operation: "Cosine", rgb16: "56f3b90d205ade971872de97", rgb8: "57b820de18de" },
    { operation: "Log", rgb16: "cddfdc3be567ed47f0f7f6c4", rgb8: "cddbe5ecf0f6" },
    { operation: "Mean", rgb16: "20a133b45555af2f919178f9", rgb8: "213455af9179" },
])(`${mode}: preserves $operation precision at depth ${depth}`, async ({ operation, rgb16, rgb8 }) => {
    const files = new Map([
        ["/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n13 30 79 235 153 61\n")],
        ["/c.ppm", new TextEncoder().encode("P3\n2 1\n255\n52 73 91 114 137 180\n")],
        ["/out", new TextEncoder().encode("KEEP")],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", "/c.ppm", "-evaluate-sequence", operation, "-endian", "MSB", "-depth", String(depth), "rgb:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(depth === 16 ? rgb16 : rgb8);
});
