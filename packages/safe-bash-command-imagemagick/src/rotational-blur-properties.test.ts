import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAYAAABfwxXFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6MDQ6MTErMDA6MDDVst6hAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjA0OjExKzAwOjAwpO9mHQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTowNDoxMSswMDowMPP6R8IAAAAlSURBVAjXYxR0qxYRFxeXxYYZNz2XuQ/lyGFIBnfsXY0kgKIAADUHDKcOxomZAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: alpha.png -rotational-blur 60 PNG32:out.png, extracted as 8-bit RGBA.
const expected = "7cb1575899ce547b5174a949568bc06b5c91c678669bd08d88ad5ca483b8638a93c87da79398cd5ef72c61370e43785470a5ac718988498e73a894ac93c89de085b0e48fabe0150d659a44256fa460489d72536b";

for (const mode of ["buffered", "retained", "command", "mogrify"])
it.each(["60", "%[fx:w*10-10]", "%[amt]", "%[image-angle]"])(`expands rotational blur angle %s (${mode})`, async angle => {
    const keep = Buffer.from("keep");
    const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", keep]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    await filesystem.writeFile("/out.png", keep);
    const args = mode === "mogrify" ? ["-set", "option:amt", "60", "-set", "image-angle", "60", "-rotational-blur", angle, "in.png"] : ["in.png", "-set", "option:amt", "60", "-set", "image-angle", "60", "-rotational-blur", angle, "PNG32:out.png"];
    let exitCode: number;
    if (mode === "command") {
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
        exitCode = result.exitCode;
    } else {
        const result = await (mode === "mogrify" ? runMogrifyCli : runMagickCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        exitCode = result.exitCode;
    }
    const output = mode === "buffered" ? files.get("out.png")! : await filesystem.readFile(mode === "mogrify" ? "/in.png" : "/out.png");
    expect(exitCode).toBe(0);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([7, 3]);
    expect(Buffer.from(image.data).toString("hex")).toBe(expected);
});
