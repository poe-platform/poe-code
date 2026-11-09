import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAYAAABfwxXFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6MDQ6MTErMDA6MDDVst6hAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjA0OjExKzAwOjAwpO9mHQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTowNDoxMSswMDowMPP6R8IAAAAlSURBVAjXYxR0qxYRFxeXxYYZNz2XuQ/lyGFIBnfsXY0kgKIAADUHDKcOxomZAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2 Q16-HDRI: alpha.png -virtual-pixel METHOD -rotational-blur ANGLE -depth 8 rgba:-.
const cases = [
    { virtualPixel: "tile", angle: 89, rgba: "72a7937892c766845a74a947588dc26b5388bd71669bc78493a1578777ac696f88bd949e8788bd4df72c6137396e905477acaf6d8799819582b2696d8ec382a788abde6a87bcca364a7f5427689da66c84945e8f" },
    { virtualPixel: "tile", angle: 90, rgba: "72a7937892c766845a74a947588dc26b5388bd71669bc78493a157877aaf5f6388bd949e8788bd4df72c6137396e905477acaf6d8799819582b2696d8ec382a788abde6a87bcca364a7f5427689da66c84945e8f" },
    { virtualPixel: "tile", angle: 91, rgba: "72a7937892c766845a74a947588dc26b5388bd71669bc78493a157877aaf5f6388bd949e8788bd4df72c6137396e905477acaf6d86a4789d82b2696d8ec382a788abde6a87bcca364a7f5427689da66c84945e8f" },
    { virtualPixel: "edge", angle: 90, rgba: "6a9f7a6192c766845a74a947588dc26b5388bd71669bc7848d9f6f9778ad808688bd949e8788bd4df72c6137396e905477acaf6d8d9a668572a7a49b93c8a0d588abde6a87bcca364a7f54276ea3784c9f943b6f" },
    { virtualPixel: "mirror", angle: 90, rgba: "6a9f7a6192c766845a74a947588dc26b5388bd71669bc7848d9f6f9778ad808688bd949e8788bd4df72c6137396e905477acaf6d8d9a66857eb0859093c8a0d588abde6a87bcca364a7f54276ea3784c8c854677" },
    { virtualPixel: "transparent", angle: 90, rgba: "70a5755792c766845a74a947588dc26b5388bd71669bc784919c5a8082b75a5a88bd949e8788bd4df72c6137396e905477acaf6d88926b7c79ae734e9cd17b8f88abde6a87bcca364a7f5427659a8642938b3d57" },
    { virtualPixel: "background", angle: 90, rgba: "9cc1a07f92c766845a74a947588dc26b5388bd71669bc784abb380a7b4d49b9588bd949e8788bd4df72c6137396e905477acaf6da5ac8ea3c3dbc1b0bfe1aadd88abde6a87bcca364a7f5427b8d1c891ccc8a4b9" },
    { virtualPixel: "white", angle: 90, rgba: "9cc1a07f92c766845a74a947588dc26b5388bd71669bc784abb380a7b4d49b9588bd949e8788bd4df72c6137396e905477acaf6da5ac8ea3c3dbc1b0bfe1aadd88abde6a87bcca364a7f5427b8d1c891ccc8a4b9" },
    { virtualPixel: "black", angle: 90, rgba: "4d72517f92c766845a74a947588dc26b5388bd71669bc7846f7845a74f6f369588bd949e8788bd4df72c6137396e905477acaf6d676f51a3364d33b065874fdd88abde6a87bcca364a7f54272e463d9145421db9" }
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
