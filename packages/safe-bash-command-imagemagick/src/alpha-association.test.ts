import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// One-pixel RGBA expectations verified against native ImageMagick.
for (const execution of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["#ff000080", "associate", [128, 0, 0, 255]],
        ["#ff000080", "disassociate", [255, 0, 0, 255]],
        ["#80402080", "associate", [64, 32, 16, 255]],
        ["#80402080", "disassociate", [255, 128, 64, 255]],
        ["#80402000", "associate", [0, 0, 0, 255]],
        ["#80402000", "disassociate", [255, 255, 255, 255]],
        ["#00000000", "disassociate", [0, 0, 0, 255]],
        ["red", "associate", [255, 0, 0, 255]],
        ["red", "disassociate", [255, 0, 0, 255]],
    ] as const)(`${execution}: %s alpha %s`, async (color, mode, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", `xc:${color}`, "-alpha", mode, "-write", "out.png", "-format", "%[channels]", "info:"];
        const result = execution === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = execution === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        const image = decodeImage(output);
        expect([...image.data]).toEqual(expected);
        expect(result.stdout.trim()).toBe(color === "red" && mode === "associate" ? "srgb  3.0" : mode === "associate" ? "srgba 4.0" : "srgb  4.0");
    });
}

it.each([
    ["associate", [128, 0, 0, 255]],
    ["disassociate", [255, 0, 0, 255]],
] as const)("magick alpha %s converts PNG stdin", async (mode, expected) => {
    const png = await sharp(new Uint8Array([255, 0, 0, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const args = createCommandArguments(["png:-", "-alpha", mode, "png:-"]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const context = {
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () { yield png; })(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
        registerCleanup() {}, fs: new MemoryFileSystem(),
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toBe("");
    expect([...decodeImage(Buffer.concat(output)).data]).toEqual(expected);
});
