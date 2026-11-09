import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -fill FILL -colorize 0 -channel A -negate +channel PNG32:out.png.
// An explicit alpha channel in the fill activates image alpha without blending its opacity.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["#5480cc40", true],
    ["#5480ccff", true],
    ["none", true],
    ["transparent", true],
    ["#58cf", true],
    ["#55558888ccccffff", true],
    ["rgba(84,128,204,1)", true],
    ["srgba(84,128,204,1)", true],
    ["graya(50%,1)", true],
    ["hsla(200,50%,50%,1)", true],
    ["#5480cc", false],
    ["rgb(84,128,204)", false],
    ["blue", false],
    ["cyan", false],
] as const)(`${mode}: colorize activates alpha for %s only when the fill has alpha`, async (fill, activatesAlpha) => {
    const input = await sharp(new Uint8Array([37, 120, 203]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    expect(decodeImage(input).hasAlpha).toBe(false);
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-fill", fill, "-colorize", "0", "-channel", "A", "-negate", "+channel", "PNG32:/out.png"];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data])
        .toEqual([37, 120, 203, activatesAlpha ? 0 : 255]);
});

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const alpha of [0, 128, 255])
it.each(["0", "100"])(`${mode}: colorize %s preserves existing alpha ${alpha} with a translucent fill`, async strength => {
    const input = await sharp(new Uint8Array([37, 120, 203, alpha]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-fill", "#5480cc40", "-colorize", strength, "PNG32:/out.png"];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data])
        .toEqual([...(strength === "0" ? [37, 120, 203] : [84, 128, 204]), alpha]);
});
