import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI adopts the Gray Hald cube's channels.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ...["sRGB", "Gray", "CMYK", "Lab", "DisplayP3", "RGB"].map(source => ({
        source, cube: "Gray", output: ["-format", "%[colorspace]:%[channels]", "info:/out"], expected: "Gray:graya 2.0",
    })),
    { source: "sRGB", cube: "Gray", output: [], expected: "343434ff" },
    { source: "sRGB", cube: "Gray", output: ["-channel", "R", "-negate", "+channel"], expected: "cbcbcbff" },
    { source: "sRGB", cube: "Gray", output: ["-channel", "A", "-evaluate", "set", "50%", "+channel"], expected: "34343480" },
    { source: "sRGB", cube: "sRGB", output: ["-format", "%[colorspace]:%[channels]", "info:/out"], expected: "sRGB:srgba 4.0" },
    { source: "sRGB", cube: "sRGB", output: ["-channel", "R", "-negate", "+channel"], expected: "cba05cff" },
])(`${mode}: $source through $cube Hald: $output`, async ({ source, cube, output, expected }) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const info = output[0] === "-format";
    const args = ["xc:#34a05c", "-colorspace", source, "(", "hald:2", "-colorspace", cube, ")", "-hald-clut",
        ...output, ...(info ? [] : ["-depth", "8", "rgba:/out"])];
    if (mode === "command") {
        let stdout = "", stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
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
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(info ? "utf8" : "hex")).toBe(expected);
});
