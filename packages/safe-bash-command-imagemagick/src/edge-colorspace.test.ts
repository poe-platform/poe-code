import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
const cases = [
    { space: "HSL", edge: false, channel: undefined, hex: "405060ff506080ff203030ff" },
    { space: "HSL", edge: true, channel: undefined, hex: "000000ffffffffff000000ff" },
    { space: "HSL", edge: true, channel: "R", hex: "604050ff508068ff202030ff" },
    { space: "Lab", edge: false, channel: undefined, hex: "405060ff506080ff203030ff" },
    { space: "Lab", edge: true, channel: undefined, hex: "008098ff00ffffff00787cff" },
    { space: "Lab", edge: true, channel: "R", hex: "00131fffcedeffff001515ff" },
    { space: "sRGB", edge: true, channel: undefined, hex: "000000ffc0c0ffff000000ff" },
];

for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each(cases)(`${mode}: preserves $space edge=$edge channel=$channel through sRGB conversion`, async ({ space, edge, channel, hex }) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["/out.raw", original]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.raw", original);
    const args = ["xc:#405060", "xc:#506080", "xc:#203030", "+append", "-colorspace", space,
        ...(channel ? ["-channel", channel] : []), ...(edge ? ["-edge", "1"] : []),
        "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out.raw"];
    let stderr = "";
    const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
