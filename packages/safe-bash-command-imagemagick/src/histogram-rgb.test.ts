import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7 RGB histogram output, including its preferred color aliases.
it.each([false, true])("matches native RGB histogram text (retained=%s)", async retained => {
    const pixels = new Uint8Array([
        255, 0, 0, 255, 0, 0, 255, 0, 0,
        0, 255, 0, 0, 255, 0, 0, 0, 255
    ]);
    const input = await sharp(pixels, { raw: { width: 6, height: 1, channels: 3 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem(), files = new Map([["rgb.png", input]]);
    await filesystem.writeFile("/rgb.png", input);
    const result = await runConvertCli(["rgb.png", "-format", "%c", "histogram:info:-"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout:
        "             1: (0,0,255) #0000FF blue\n" +
        "             2: (0,255,0) #00FF00 lime\n" +
        "             3: (255,0,0) #FF0000 red\n" });
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["rgb.png"]);
    expect([...files.keys()]).toEqual(["rgb.png"]);
});

it.each([false, true])("uses native RGB names and unnamed-color fallback (retained=%s)", async retained => {
    const input = await sharp(new Uint8Array([255, 0, 255, 0, 255, 255, 169, 169, 169, 18, 52, 86]), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem(), files = new Map([["rgb.png", input]]);
    await filesystem.writeFile("/rgb.png", input);
    const result = await runConvertCli(["rgb.png", "-format", "%c", "histogram:info:-"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stderr: "", stdout:
        "             1: (0,255,255) #00FFFF cyan\n" +
        "             1: (18,52,86) #123456 srgb(18,52,86)\n" +
        "             1: (169,169,169) #A9A9A9 DarkGray\n" +
        "             1: (255,0,255) #FF00FF magenta\n" });
});
