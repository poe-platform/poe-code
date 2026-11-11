import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand } from "./index.js";

const blue = new Uint8Array([80, 54, 10, 49, 32, 49, 10, 50, 53, 53, 10, 0, 0, 255]);

async function execute(fs: MemoryFileSystem, args: string[]) {
    const stdout: number[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args, cwd: "/images", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    return { ...result, stdout, stderr };
}

for (const seeded of [false, true])
it.each([
    ["snap.ppm", "snap.ppm"],
    ["snap.ppm", "./snap.ppm"],
    ["snap.ppm", "././snap.ppm"],
    ["././snap.ppm", "snap.ppm"],
    ["/images/snap.ppm", "./snap.ppm"],
    ["snap.ppm", "../images/snap.ppm"]
])(`reads the latest write from %s as %s (seeded=${seeded})`, async (output, input) => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/images");
    if (seeded) await fs.writeFile("/images/snap.ppm", blue);
    expect(await execute(fs, ["xc:red", "-write", output, "+delete", input, "-depth", "8", "rgb:-"]))
        .toEqual({ exitCode: 0, stdout: [255, 0, 0], stderr: "" });
    expect([...decodeImage(await fs.readFile("/images/snap.ppm")).data]).toEqual([255, 0, 0, 255]);
});

it("retains and publishes the last write when equivalent paths alternate", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/images");
    expect(await execute(fs, [
        "xc:red", "-write", "snap.ppm", "+delete",
        "xc:blue", "+write", "./snap.ppm", "+delete",
        "xc:lime", "-write", "snap.ppm", "+delete",
        "././snap.ppm", "-depth", "8", "rgb:-"
    ])).toEqual({ exitCode: 0, stdout: [0, 255, 0], stderr: "" });
    expect([...decodeImage(await fs.readFile("/images/snap.ppm")).data]).toEqual([0, 255, 0, 255]);
});

it.each(["./snap.ppm", "././snap.ppm"])("reads an existing %s without an intermediate write", async input => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/images");
    await fs.writeFile("/images/snap.ppm", blue);
    expect(await execute(fs, [input, "-depth", "8", "rgb:-"]))
        .toEqual({ exitCode: 0, stdout: [0, 0, 255], stderr: "" });
});
