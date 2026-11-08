import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([false, true])(`clears source colors outside transparent rotation, alpha off=%s (${mode})`, async alphaOff => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(v => [v, v, v]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-background", "none", "-rotate", "30", ...(alphaOff ? ["-alpha", "off"] : []), "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([6, 6]);
        // Native ImageMagick 7 RGBA samples, including hidden transparent RGB.
        const expected = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 6, 6, 6, 109, 5, 5, 5, 119, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            187, 187, 187, 13, 110, 110, 110, 255, 67, 67, 67, 255, 53, 53, 53, 220, 80, 80, 80, 75, 0, 0, 0, 0,
            0, 0, 0, 0, 150, 150, 150, 75, 177, 177, 177, 220, 163, 163, 163, 255, 120, 120, 120, 255, 43, 43, 43, 13,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 225, 225, 225, 119, 224, 224, 224, 109, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        expect([...output.data]).toEqual(expected.map((value, index) => alphaOff && index % 4 === 3 ? 255 : value));
    });
}
