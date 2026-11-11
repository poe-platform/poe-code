import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the cube before lookup.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    { interpolation: "bilinear", depth: "16", expected: "41418787c9c97333" },
    { interpolation: "bilinear", depth: "8", expected: "4187c973" },
    { interpolation: "catrom", depth: "16", expected: "1b8c3d535ace7333" },
    { interpolation: "catrom", depth: "8", expected: "1b3d5a73" },
    { interpolation: undefined, depth: "16", expected: "0000000000007333" },
])(`${mode}: preserves fractional cube alpha, $interpolation, depth=$depth`, async ({ interpolation, depth, expected }) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const cube = ["hald:2", "-alpha", "set", "-channel", "A", "-evaluate", "set", "45%", "+channel"];
    const args = [
        ...(interpolation ? ["xc:#4187c9a0", "(", ...cube, ")", "-interpolate", interpolation, "-hald-clut"]
            : [...cube, "-crop", "1x1+0+0", "+repage"]),
        "-depth", depth, "-endian", "MSB", `rgba:${mode === "command" ? "-" : "/out"}`,
    ];
    let output: Uint8Array;
    if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
        output = Buffer.concat(chunks);
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
