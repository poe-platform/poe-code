import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAYAAABfwxXFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6MDQ6MTErMDA6MDDVst6hAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjA0OjExKzAwOjAwpO9mHQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTowNDoxMSswMDowMPP6R8IAAAAlSURBVAjXYxR0qxYRFxeXxYYZNz2XuQ/lyGFIBnfsXY0kgKIAADUHDKcOxomZAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI, background #ef2c98, rotational blur 90, 8-bit RGBA.
const expected = {
    "horizontal-tile": "977f807f92c766845a74a947588dc26b5388bd71669bc784a78268a7ad80729588bd949e8788bd4df72c6137396e905477acaf6da17a75a3ba6687b0b99685dd88abde6a87bcca364a7f5427b05e9091c4596db9",
    "vertical-tile": "72a7937892c766845a74a947588dc26b5388bd71669bc78493a157877aaf5f6388bd949e8788bd4df72c6137396e905477acaf6d8799819582b2696d8ec382a788abde6a87bcca364a7f5427689da66c84945e8f",
    "checker-tile": "977f807f92c766845a74a947588dc26b5388bd71669bc784a78268a7ad80729588bd949e8788bd4df72c6137396e905477acaf6da17a75a3ba6687b0b99685dd88abde6a87bcca364a7f5427b05e9091c4596db9",
    "horizontal-tile-edge": "6a9f7a6192c766845a74a947588dc26b5388bd71669bc7848d9f6f9778ad808688bd949e8788bd4df72c6137396e905477acaf6d8d9a668572a7a49b93c8a0d588abde6a87bcca364a7f54276ea3784c9f943b6f",
    "vertical-tile-edge": "72a7937892c766845a74a947588dc26b5388bd71669bc78493a157877aaf5f6388bd949e8788bd4df72c6137396e905477acaf6d8799819582b2696d8ec382a788abde6a87bcca364a7f5427689da66c84945e8f",
};

for (const mode of ["buffered", "retained", "command"]) {
    for (const blur of [false, true]) {
        it.each([...Object.keys(expected), "edge", "bogus"])(`samples virtual pixels %s (${mode}, blur=${blur})`, async method => {
            const keep = Buffer.from("keep"), files = new Map<string, Uint8Array>([["in.png", input], ["out.png", keep]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            await filesystem.writeFile("/out.png", keep);
            const args = ["in.png", "-background", "#ef2c98", "-virtual-pixel", method, ...(blur ? ["-rotational-blur", "90"] : []), "PNG32:out.png"];
            let exitCode: number;
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                exitCode = result.exitCode;
            } else {
                exitCode = (await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode;
            }
            const output = mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png");
            if (method === "bogus") {
                expect(exitCode).not.toBe(0);
                expect(Buffer.from(output)).toEqual(keep);
            } else {
                expect(exitCode).toBe(0);
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([7, 3]);
                if (!blur) expect(image.data).toEqual(decodeImage(input).data);
                else if (method !== "edge") expect(Buffer.from(image.data).toString("hex")).toBe(expected[method as keyof typeof expected]);
            }
        });
    }
}

// Native ImageMagick pixel expressions probe negative tiles and both checker parities.
const expressions = [
    ["horizontal-tile", "p{i-8,j-4}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["horizontal-tile", "p{i+8,j+4}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["horizontal-tile", "p{i-8,j}", "9bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea53c71a68eb2e71cdfc9fe33fce0154a1af72c61370e437854255a8f71dd12475a5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303d"],
    ["horizontal-tile", "p{i,j-4}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["vertical-tile", "p{i-8,j-4}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["vertical-tile", "p{i+8,j+4}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["vertical-tile", "p{i-8,j}", "ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["vertical-tile", "p{i,j-4}", "5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475a11467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c2b2e71cdfc9fe33fce0154a1af72c61370e437854255a8f713c71a68e"],
    ["checker-tile", "p{i-8,j-4}", "dd12475aef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff11467b14285d92313f74a94e568bc06b6da2d78884b9eea5ef2c98ffb2e71cdfc9fe33fce0154a1af72c61370e437854255a8f71"],
    ["checker-tile", "p{i+8,j+4}", "c9fe33fce0154a1af72c61370e437854255a8f713c71a68eef2c98ff6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475aef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff11467b14"],
    ["checker-tile", "p{i-8,j}", "9bd005c2ef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff3c71a68eef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffdd12475aef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["checker-tile", "p{i,j-4}", "5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475aef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ffef2c98ff"],
    ["horizontal-tile-edge", "p{i-8,j-4}", "9bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea5"],
    ["horizontal-tile-edge", "p{i+8,j+4}", "6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475a5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475a5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475a5388bdab"],
    ["horizontal-tile-edge", "p{i-8,j}", "9bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea53c71a68eb2e71cdfc9fe33fce0154a1af72c61370e437854255a8f71dd12475a5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303d"],
    ["horizontal-tile-edge", "p{i,j-4}", "11467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c211467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c2"],
    ["vertical-tile-edge", "p{i-8,j-4}", "5388bdab5388bdab5388bdab5388bdab5388bdab5388bdab5388bdab11467b1411467b1411467b1411467b1411467b1411467b1411467b14b2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdf"],
    ["vertical-tile-edge", "p{i+8,j+4}", "3c71a68e3c71a68e3c71a68e3c71a68e3c71a68e3c71a68e3c71a68edd12475add12475add12475add12475add12475add12475add12475a9bd005c29bd005c29bd005c29bd005c29bd005c29bd005c29bd005c2"],
    ["vertical-tile-edge", "p{i-8,j}", "11467b1411467b1411467b1411467b1411467b1411467b1411467b14b2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdfb2e71cdf5388bdab5388bdab5388bdab5388bdab5388bdab5388bdab5388bdab"],
    ["vertical-tile-edge", "p{i,j-4}", "5388bdab6a9fd4c881b6ebe598cd0203afe41920c6fb303ddd12475a11467b14285d92313f74a94e568bc06b6da2d78884b9eea59bd005c2b2e71cdfc9fe33fce0154a1af72c61370e437854255a8f713c71a68e"],
];
for (const retained of [false, true]) it.each(expressions)(`matches native %s %s (retained=${retained})`, async (method, expression, pixels) => {
    const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const result = await runMagickCli(["in.png", "-background", "#ef2c98", "-virtual-pixel", method!, "-fx", expression!, "PNG32:out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = retained ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(pixels);
});
