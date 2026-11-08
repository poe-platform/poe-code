import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [
    [16, 32, 48, 255], [64, 80, 96, 255], [112, 128, 144, 255],
    [160, 176, 192, 255], [208, 224, 240, 255], [24, 40, 56, 255],
];
const transparent = [[255, 0, 0, 0], [0, 0, 255, 255]];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["p{0.5,0}", [40, 56, 72, 255], pixels],
        ["p{0.5,0.5}", [112, 128, 144, 255], pixels],
        ["p{1,0}", [64, 80, 96, 255], pixels],
        ["p{-0.5,0}", [16, 32, 48, 255], pixels],
        ["u.p{0.5,0}.g", [56, 56, 56, 56], pixels],
        ["p{0.5,0}", [0, 0, 255, 128], transparent],
    ] as const)(`${mode}: interpolates %s`, async (expression, pixel, source) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [name, data] of [["input.png", source]] as const) {
            const input = encodeImage({ width: source === pixels ? 3 : 2, height: source === pixels ? 2 : 1, data: Uint8Array.from(data.flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: source === transparent }, { format: "png" }).data;
            files.set(name, input);
            await filesystem.writeFile(`/${name}`, input);
        }
        const args = ["input.png", "-fx", expression, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(Array.from({ length: source.length }, () => pixel).flat());
    });
}

it("identify interpolates stored fractional pixel references", async () => {
    const filesystem = new MemoryFileSystem();
    const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(transparent.flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    await filesystem.writeFile("/input.png", input);
    const argumentValues = createCommandArguments(["-format", "%[fx:p{0.5,0}.r]|%[fx:p{0.5,0}.b]|%[fx:p{0.5,0}.a]", "input.png"]);
    let stdout = "";
    const result = await createIdentifyCommand().execute({
        command: "identify", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} },
        signal: new AbortController().signal, registerCleanup() {},
    });
    expect(result.exitCode).toBe(0);
    expect(stdout).toBe("0|1|0.5");
});
