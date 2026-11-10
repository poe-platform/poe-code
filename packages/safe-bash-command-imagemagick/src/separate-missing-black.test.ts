import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runCompareCli, runCompareCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
for (const evaluate of [false, true])
for (const alpha of [false, true])
for (const channel of ["K", "Black", "R"])
it(`${mode}: separating ${channel} preserves sibling files, alpha=${alpha}, evaluate=${evaluate}`, async () => {
    const pixels = Array.from({ length: 64 }, () => [18, 69, 120, alpha ? 128 : 255]).flat();
    const source = encodeImage({ width: 8, height: 8, format: "png", space: "srgb", depth: "uchar",
        density: 72, channels: alpha ? 4 : 3, hasAlpha: alpha, data: Uint8Array.from(pixels) }, { format: "png" }).data;
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["in.png", source], ...["out.png", "out-0.png", "out-1.png", "out-2.png"].map(name => [name, keep] as const)]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const argv = ["in.png", ...(evaluate ? ["-evaluate", "Add", "0"] : []), "-channel", channel, "-separate", "PNG32:out.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : mode === "buffered" ? await runMagickCli(argv, files)
        : await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    for (const name of ["out-0.png", "out-1.png", "out-2.png"])
        expect(mode === "command" ? await fs.readFile(`/${name}`) : files.get(name)).toEqual(keep);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect([output.width, output.height]).toEqual([8, 8]);
    const value = channel === "R" ? 18 : 0;
    expect(Array.from(output.data)).toEqual(Array.from({ length: 64 }, () => [value, value, value, 255]).flat());
    const compareArgs = ["-metric", "RMSE", "(", "in.png", "-channel", channel, "-separate", "+channel", ")", "out.png", "null:"];
    const comparison = mode === "sync" ? runCompareCliSync(compareArgs, files)
        : await runCompareCli(compareArgs, mode === "command" ? { filesystem: fs, cwd: "/" } : files);
    expect(comparison).toMatchObject({ exitCode: 0, stderr: "0 (0)" });
});

// ImageMagick 7.1.2-35 Q16-HDRI: RGB has no black ink, even with linear samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [alpha, colorspace, channel, expected] of [
    ["38", "RGB", "K", "000000ff"],
    ["80", "RGB", "K", "000000ff"],
    ["38", "RGB", "A", "383838ff"],
    ["38", "sRGB", "K", "000000ff"]
] as const)
it(`${mode}: separates ${channel} in ${colorspace} with alpha=${alpha}`, async () => {
    const files = new Map([["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    const argv = [`xc:#2060b0${alpha}`, "-colorspace", colorspace, "-channel", channel, "-separate", "-depth", "8", "rgba:out"];
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
