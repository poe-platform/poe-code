import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves the color spelling's colorspace.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const prefix of ["xc", "canvas"])
it.each([
    ["gray40", "Gray|gray  1.0"],
    ["grey40", "Gray|gray  1.0"],
    ["gray(40%)", "Gray|gray  1.0"],
    ["graya(40%,0.5)", "Gray|graya 2.0"],
    ["#666666", "sRGB|srgb  3.0"],
    ["black", "sRGB|srgb  3.0"],
    ["red", "sRGB|srgb  3.0"],
])(`${mode}: ${prefix}:%s retains its native colorspace and channels`, async (color, expected) => {
    const files = new Map<string, Uint8Array>([["out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("out")!);
    const args = [`${prefix}:${color}`, "-format", "%[colorspace]|%[channels]", "info:out"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
    expect(new TextDecoder().decode(output)).toBe(expected);
});
