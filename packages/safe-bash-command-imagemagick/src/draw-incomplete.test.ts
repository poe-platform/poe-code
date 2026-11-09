import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

async function draw(primitive: string) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
    const argumentValues = createCommandArguments(["-size", "7x5", "xc:white", "-fill", "red", "-draw", primitive, "out.png"]);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs,
    } as unknown as CommandContext;
    const result = await createMagickCommand().execute(context);
    return { result, bytes: await fs.readFile("/out.png") };
}

it.each([
    "point", "point 4", "rectangle 1,1", "rectangle 1,1 2",
    "circle 1,1 2", "line 1,1 2", "roundrectangle 1,1 3,3 1",
    "ellipse 3,2 2,1 0", "polygon", "polygon 1,1 3,1", "polygon 1,1 3,1 2",
    "polyline", "polyline 1,1 3", "bezier 1,1 3,1", "bezier 1,1 3,1 2",
    "point NaN,1", "point 1,Infinity", "point 4 fill blue",
    "rectangle 0,0 2,2 point 4",
])("rejects incomplete or nonfinite drawing and preserves the destination: %s", async (primitive) => {
    const { result, bytes } = await draw(primitive);
    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(bytes)).toBe("keep");
});

it.each(["point 4,3", "rectangle 1,1 2,2"])("preserves exact pixels for valid %s", async (primitive) => {
    const { result, bytes } = await draw(primitive);
    expect(result.exitCode).toBe(0);
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([7, 5]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
        const red = primitive.startsWith("point") ? x === 4 && y === 3 : x >= 1 && x <= 2 && y >= 1 && y <= 2;
        expect([...image.data.subarray((y * 7 + x) * 4, (y * 7 + x + 1) * 4)]).toEqual(red ? [255, 0, 0, 255] : [255, 255, 255, 255]);
    }
});
