import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli } from "./index.js";

it.each([false, true])("reports trim bounds without changing canvas dimensions (empty=%s)", async empty => {
    const width = empty ? 2 : 7, height = empty ? 2 : 6;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    if (!empty) for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) pixels.set([255, 255, 255, 255], (y * width + x) * 4);
    const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/shape.png", bytes);
    const args = ["-format", "%@|%wx%h|%g|%%@", "/shape.png"];
    const expected = `${empty ? "0x0+2+2" : "4x3+1+2"}|${width}x${height}|${width}x${height}+0+0|%@`;
    for (const input of [new Map([["/shape.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
        const result = await runIdentifyCli(args, input);
        expect(result.stdout).toBe(expected);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe(empty ? "magick: geometry does not contain image\n" : "");
    }
    const argumentValues = createCommandArguments(["identify", ...args]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: empty ? "magick: geometry does not contain image\n" : "" });
    expect(await fs.readFile("/shape.png")).toEqual(bytes);
});
