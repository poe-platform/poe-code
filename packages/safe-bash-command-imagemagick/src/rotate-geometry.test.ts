import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Decoded grayscale rasters from native ImageMagick 7 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["90x0", 2, 4, [130, 10, 160, 40, 190, 70, 220, 100]],
        ["90!", 2, 4, [130, 10, 160, 40, 190, 70, 220, 100]],
        ["+90", 2, 4, [130, 10, 160, 40, 190, 70, 220, 100]],
        ["-90", 2, 4, [100, 220, 70, 190, 40, 160, 10, 130]],
        ["1/2", 6, 4, [255, 243, 254, 255, 253, 255, 244, 22, 39, 70, 108, 246, 254, 134, 161, 189, 214, 255, 255, 252, 255, 255, 254, 255]],
        ["0.5", 6, 4, [255, 245, 254, 255, 252, 255, 244, 23, 40, 70, 108, 246, 255, 133, 161, 190, 215, 255, 255, 251, 255, 255, 255, 255]],
        ["-1.5", 6, 4, [255, 251, 255, 254, 248, 255, 242, 24, 41, 70, 109, 247, 255, 127, 158, 191, 219, 255, 255, 248, 254, 255, 255, 255]],
    ] as const)(`rotates geometry %s (${mode})`, async (angle, width, height, expected) => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(v => [v, v, v]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-rotate", angle, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
}

it.each(["90oops", "NaN", "Infinity", ""])("rejects invalid rotation %j", async angle => {
    const result = await runConvertCli(["-size", "4x2", "xc:red", "-rotate", angle, "out.png"], new Map());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid rotation angle");
});
