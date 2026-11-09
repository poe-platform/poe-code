import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Grid and translated pixels recorded with ImageMagick 7.1.2-35 Q16-HDRI.
const grid = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAICAIAAABPmPnhAAAANUlEQVR4nGPk1fGOxQ0Y1597i086sKAfn/RnIUN80lO3XMYnbR5Wik/65g9xfNLVs3bikQYAyL1ayQ0vjokAAAAASUVORK5CYII=", "base64");
const translated = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAICAMAAAD3JJ6EAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAACoUExURQ0sS2qJqMfmBSRDYoGgv979HDtaeZi31q/O7QwrSmmIp8blBCNCYYCfvt38GzpZeFFwj67N7AsqSWiHpsXkAyJBYH+evdz7GvMSMVBvjq3M6wopSGeGpcTjAiFAX36dvJW00/IRME9ujazL6gkoR2aFpMPiASA/XjdWdZSz0vEQL05tjKvK6QgnRmWEo8LhANn4FzZVdJOy0fAPLk1si6rJ6AcmRWSDouSQmrgAAAAHdElNRQfqCwcJGQl8AbHfAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjI1OjA5KzAwOjAwnVlCpwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOToyNTowOSswMDowMOwE+hsAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDk6MjU6MDkrMDA6MDC7EdvEAAAAV0lEQVQI12NgYGBgZGJmYWVjZ0BicnBwcHJx8/Dy8TMICAgICgmLiIqJM0hISEhKScvIyskzKCgoKCopq6iqqTNoaGhoamnr6OrpMxgYGBgaGZuYmpkDAMEQB3GVeCidAAAAAElFTkSuQmCC", "base64"));

it.each(["0,0 2,1", "0,0 2,1 9,0 11,1", "0,0 2,1 9,0 11,1 0,7 2,8"])("matches native translated pixels through the public command: %s", async points => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", grid);
    await fs.writeFile("/out.png", new TextEncoder().encode("KEEP"));
    const argumentValues = createCommandArguments(["/input.png", "-filter", "point", "-distort", "Perspective", points, "/out.png"]);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([10, 8]);
    expect(output.data).toEqual(translated.data);
});

it.each([
    ["one-point translation", "1,1 4,2", "1,0,3,0,1,1,0,0"],
    ["two-point translation", "0,0 2,1 9,0 11,1", "1,0,2,0,1,1,0,0"],
    ["three-point translation", "0,0 2,1 9,0 11,1 0,7 2,8", "1,0,2,0,1,1,0,0"],
    ["negative translation", "4,2 1,1", "1,0,-3,0,1,-1,0,0"],
])("applies Perspective %s in both backends", async (_name, points, projection) => {
    const pixels = Uint8Array.from({ length: 10 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 37 % 256);
    const input = await sharp(pixels, { raw: { width: 10, height: 8, channels: 4 } }).png().toBuffer();
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/input.png", input], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", original);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        for (const [method, args, path] of [["Perspective", points!, "/out.png"], ["PerspectiveProjection", projection!, "/reference.png"]]) {
            expect((await runMagickCli(["/input.png", "-filter", "point", operator, method!, args!, path!], backend)).exitCode).toBe(0);
        }
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const reference = decodeImage(retained ? await filesystem.readFile("/reference.png") : files.get("/reference.png")!);
        expect([output.width, output.height]).toEqual([reference.width, reference.height]);
        expect(output.data).toEqual(reference.data);
        expect((await runMagickCli(["identify", "-format", "%g", "/out.png"], backend)).stdout)
            .toBe((await runMagickCli(["identify", "-format", "%g", "/reference.png"], backend)).stdout);
        if (operator === "-distort") expect(output.data).not.toEqual(pixels);
    }
});

it.each([
    { name: "two-point rotation and scale", points: "1,1 8,2 4,1 8,8", x: 4, y: 4, pixel: [35, 45, 0, 255], width: 18, height: 22, left: -7, top: -1 },
    { name: "three-point shear and scale", points: "0,0 2,1 9,0 20,1 0,7 9,8", x: 6, y: 3, pixel: [10, 40, 0, 255], width: 30, height: 10, left: 1, top: 0 },
])("applies $name at physical pixel centers", async ({ points, x, y, pixel, width, height, left, top }) => {
    const pixels = Uint8Array.from({ length: 10 * 8 * 4 }, (_, i) => {
        const channel = i % 4, position = Math.floor(i / 4);
        return channel === 0 ? position % 10 * 20 : channel === 1 ? Math.floor(position / 10) * 20 : channel === 3 ? 255 : 0;
    });
    const input = await sharp(pixels, { raw: { width: 10, height: 8, channels: 4 } }).png().toBuffer();
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["/input.png", "-filter", "point", operator, "Perspective", points, "/out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const bestFit = operator === "+distort";
        expect([output.width, output.height]).toEqual(bestFit ? [width, height] : [10, 8]);
        const position = ((y - (bestFit ? top : 0)) * output.width + x - (bestFit ? left : 0)) * 4;
        expect([...output.data.slice(position, position + 4)]).toEqual(pixel);
    }
});
