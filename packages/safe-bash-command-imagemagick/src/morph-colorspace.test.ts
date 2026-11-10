import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including both unchanged endpoints.
for (const mode of ["map", "sync", "filesystem", "command"])
it.each([
    { colorspace: "HSL", count: "1", expected: "d14590ff2d30b4ff238955ff" },
    { colorspace: "Lab", count: "1", expected: "d14590ff8e7473ff238955ff" },
    { colorspace: "XYZ", count: "1", expected: "d14590ff9b6e77ff238955ff" },
    { colorspace: "YUV", count: "1", expected: "d14590ff7a6773ff238955ff" },
    { colorspace: "Lab", count: "2", expected: "d14590ffa5687dff747c69ff238955ff" },
    { colorspace: "HSL", count: "0", expected: "d14590ff238955ff" },
    { colorspace: "sRGB", count: "1", expected: "d14590ff7a6773ff238955ff" }
])(`interpolates working $colorspace samples with $count morph frames (${mode})`, async ({ colorspace, count, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["xc:#d14590", "xc:#238955", "-colorspace", colorspace, "-morph", count, "-colorspace", "sRGB", "+append", "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
