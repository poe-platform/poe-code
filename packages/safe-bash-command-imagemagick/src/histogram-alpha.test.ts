import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runIdentifyCli } from "./index.js";

it.each(["memory", "retained", "streamed"])("distinguishes RGBA histogram entries (%s)", async mode => {
    const pixels = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 128]);
    const bytes = await sharp(pixels, { raw: { width: 6, height: 1, channels: 4 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem(), files = new Map([["rgba.png", bytes]]), chunks: Uint8Array[] = [];
    await filesystem.writeFile("/rgba.png", bytes);
    const input = mode === "memory" ? files : { filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(chunk: Uint8Array) { chunks.push(chunk.slice()); } } } : {}) };
    const result = await runConvertCli(["rgba.png", "-format", "%c", "histogram:info:-"], input);
    const expected = "  2: (255,0,0,255) #FF0000FF srgba(255,0,0,1)\n"
        + "  1: (0,0,255,255) #0000FFFF srgba(0,0,255,1)\n"
        + "  1: (0,255,0,0) #00FF0000 srgba(0,255,0,0)\n"
        + "  1: (0,0,255,0) #0000FF00 srgba(0,0,255,0)\n"
        + "  1: (255,0,0,128) #FF000080 srgba(255,0,0,0.501961)\n";
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    if (mode === "streamed") expect(result.stdout).toBe("");
    const output = mode === "streamed" ? new TextDecoder().decode(Buffer.concat(chunks)) : result.stdout;
    expect(output.trim().split("\n").map(line => line.trim()).sort()).toEqual(expected.trim().split("\n").map(line => line.trim()).sort());
    expect(await runIdentifyCli(["-format", "%k", "rgba.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stdout: "5" });
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["rgba.png"]);
    expect([...files.keys()]).toEqual(["rgba.png"]);
});

