import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAYAAABfwxXFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6MDQ6MTErMDA6MDDVst6hAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjA0OjExKzAwOjAwpO9mHQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTowNDoxMSswMDowMPP6R8IAAAAlSURBVAjXYxR0qxYRFxeXxYYZNz2XuQ/lyGFIBnfsXY0kgKIAADUHDKcOxomZAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2 Q16-HDRI: alpha.png -virtual-pixel METHOD -rotational-blur ANGLE -depth 8 rgba:-.
const cases = [
    { virtualPixel: "gray", angle: 89, rgba: "7599797f92c766845a74a947588dc26b5388bd71669bc7848d9663a77da46d8e88bd949e8788bd4df72c6137396e905477acaf6d868e70a37c947ab092b47ddd88abde6a87bcca364a7f5427738c8391898560b9" },
    { virtualPixel: "gray", angle: 91, rgba: "7599797f92c766845a74a947588dc26b5388bd71669bc7848d9663a781a1699588bd949e8788bd4df72c6137396e905477acaf6d829173b07c947ab092b47ddd88abde6a87bcca364a7f5427738c8391898560b9" }
];

for (const mode of ["buffered", "retained", "command"])
it.each(cases)(`matches native rotational blur at $angle degrees with $virtualPixel pixels (${mode})`, async ({ virtualPixel, angle, rgba }) => {
    const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", Buffer.from("keep")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    await filesystem.writeFile("/out.png", Buffer.from("keep"));
    const args = ["in.png", "-virtual-pixel", virtualPixel, "-rotational-blur", String(angle), "PNG32:out.png"];
    if (mode === "command") {
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
        expect(result.exitCode).toBe(0);
    } else {
        const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
    }
    const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([7, 3]);
    expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
});
