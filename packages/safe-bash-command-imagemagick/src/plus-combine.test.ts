import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 channel layouts and decoded bytes.
for (const mode of ["buffered", "sync", "retained", "command"] as const)
for (const [operator, colorspace, info, rgba] of [
    ["+combine", "CMYK", "1/CMYK/cmyk  4.0", "ff00ffff"],
    ["+combine", "sRGB", "1/sRGB/srgba 4.0", "00ff0000"],
    ["+combine", "Undefined", "1/sRGB/srgba 4.0", "00ff0000"],
    ["+combine", "HSL", "1/HSL/hsl  3.0", "000000ff"],
    ["+combine", "RGB", "1/RGB/rgb  3.0", "00ff00ff"],
    ["+combine", "Lab", "1/CIELab/cielab  3.0", "0032ccff"],
    ["+combine", "Gray", "1/Gray/graya 4.2", "000000ff"],
    ["-combine", "", "1/sRGB/srgba 4.0", "00ff0000"],
    ["+combine", "not-a-colorspace", "", ""],
] as const)
for (const count of [3, 4, 5])
for (const output of ["info", "rgba"] as const)
it(`${mode}: ${operator} ${colorspace} ${count} planes ${output}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = [...["xc:black", "xc:white", "xc:black", "xc:black", "xc:white"].slice(0, count), operator,
        ...(colorspace ? [colorspace] : []),
        ...(output === "info" ? ["-format", "%n/%[colorspace]/%[channels]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(value) { stderr += new TextDecoder().decode(value); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if (colorspace === "not-a-colorspace") {
        expect(result.exitCode).toBe(1);
        expect("stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toContain("unrecognized colorspace");
        return;
    }
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    let expectedInfo: string = info, expectedRgba: string = rgba;
    if (colorspace === "CMYK" && count === 5) expectedInfo = "1/CMYK/cmyka 5.0";
    if (colorspace === "Gray") expectedInfo = `1/Gray/graya ${count}.${count - 2}`;
    if (colorspace === "sRGB" || colorspace === "Undefined" || operator === "-combine") {
        if (count === 3) { expectedInfo = "1/sRGB/srgb  3.0"; expectedRgba = "00ff00ff"; }
        if (count === 5) expectedInfo = "1/sRGB/srgba 5.1";
    }
    expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex"))
        .toBe(output === "info" ? expectedInfo : expectedRgba);
});
