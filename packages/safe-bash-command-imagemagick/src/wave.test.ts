import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createImagemagickCommand, runConvertCliSync } from "./index.js";

const checkerboard = readFileSync(new URL("./fixtures/wave-checkerboard.png", import.meta.url));
const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.each([
    { geometry: "3", explicit: "3x1", height: 11 },
    { geometry: "x4", explicit: "0x4", height: 5 },
    { geometry: "2x4", explicit: "2x4", height: 9 },
    { geometry: "0x4", explicit: "0x4", height: 5 },
])("uses native wave defaults for $geometry", async ({ geometry, explicit, height }) => {
    const input = readFileSync(new URL("./fixtures/wave-rgb.png", import.meta.url));
    const files = new Map<string, Uint8Array>([["/input.png", input]]);
    expect(runConvertCliSync(["/input.png", "-wave", explicit, "/expected.png"], files).exitCode).toBe(0);
    const expected = decodeImage(files.get("/expected.png")!);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = createCommandArguments(["/input.png", "-wave", geometry, "/output.png"]);
    expect((await createImagemagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    })).exitCode).toBe(0);
    expect(runConvertCliSync(["/input.png", "-wave", geometry, "/output.png"], files).exitCode).toBe(0);
    for (const bytes of [await fs.readFile("/output.png"), files.get("/output.png")!]) {
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([7, height]);
        expect(output.data).toEqual(expected.data);
        if (height === 5) expect(output.data).toEqual(decodeImage(input).data);
        if (nativeAvailable) {
            const native = spawnSync("magick", ["png:-", "-wave", geometry, "-depth", "8", "rgba:-"], { input });
            expect(native.status).toBe(0);
            expect([...output.data]).toEqual([...native.stdout]);
        }
    }
});

it.each([
    { options: ["-background", "yellow"], corner: [0, 0, 0, 255] },
    { options: ["-virtual-pixel", "background", "-background", "yellow"], corner: [255, 255, 0, 255] },
    { options: ["-background", "white"], corner: [255, 255, 255, 255] },
    { options: ["-background", "yellow"], rgb: true, corner: [255, 255, 0, 255] },
    { options: ["-virtual-pixel", "edge", "-background", "yellow"], corner: [0, 0, 0, 255] },
    { options: ["-virtual-pixel", "background", "+virtual-pixel", "-background", "yellow"], corner: [0, 0, 0, 255] },
    { options: [], corner: [15, 15, 15, 255] },
])("matches native checkerboard wave through the public command: $options rgb=$rgb", async ({ options, corner, rgb }) => {
    const input = rgb ? encodeImage({ ...decodeImage(checkerboard), space: "srgb", channels: 3 }, { format: "png" }).data : checkerboard;
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = createCommandArguments(["/input.png", ...options, "-wave", "4x15", "/output.png"]);
    expect((await createImagemagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    })).exitCode).toBe(0);
    const output = decodeImage(await fs.readFile("/output.png"));
    expect([output.width, output.height]).toEqual([31, 31]);
    expect([...output.data.slice(0, 4)]).toEqual(corner);
    const files = new Map<string, Uint8Array>([["/input.png", input]]);
    expect(runConvertCliSync(["/input.png", ...options, "-wave", "4x15", "/output.png"], files).exitCode).toBe(0);
    expect(decodeImage(files.get("/output.png")!).data).toEqual(output.data);
    if (nativeAvailable) {
        const native = spawnSync("magick", ["png:-", ...options, "-wave", "4x15", "-depth", "8", "rgba:-"], { input });
        expect(native.status).toBe(0);
        expect(native.stdout.length).toBe(output.data.length);
        expect([...output.data]).toEqual([...native.stdout]);
    }
});
