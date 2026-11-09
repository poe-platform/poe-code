import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// ImageMagick 7 Q16-HDRI, -size 7x5 xc:white -fill red, decoded as 8-bit RGBA.
const circleGreen = [248,106,0,106,247,255,255,107,0,0,0,106,255,255,0,0,0,0,0,255,255,106,0,0,0,107,255,255,248,107,0,106,248,255,255];
for (const mode of ["command", "map"] as const)
for (const prefix of ["", "point 6,4 "])
for (const switches of [[], ["-antialias"], ["+antialias"], ["+antialias", "-antialias"]])
it.each(["circle 2,2 4,2", "stroke blue stroke-width 1 line 1,1 4,1", "fill none stroke blue stroke-width 1 line 1,1 4,1"])(`${mode} ${prefix}${switches.join(" ")}: native edge pixels for %s`, async draw => {
    const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("keep");
    await fs.writeFile("/out.png", keep);
    const files = new Map([["/out.png", keep]]);
    const args = ["-size", "7x5", "xc:white", "-fill", "red", ...switches, "-draw", prefix + draw, "/out.png"];
    const result = mode === "map" ? await runConvertCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(0);
    const image = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const hard = switches.at(-1) === "+antialias";
    const expected = Array.from({ length: 35 }, (_, i) => {
        if (prefix && i === 34) return [255, 0, 0, 255];
        if (draw.startsWith("circle")) {
            const green = hard ? (circleGreen[i]! < 128 ? 0 : 255) : circleGreen[i]!;
            return [255, green, green, 255];
        }
        const x = i % 7, y = Math.floor(i / 7);
        const value = y === 1 && x >= 1 && x <= 4 ? 0 : !hard && ((y === 1 && x === 5) || (y === 2 && x >= 1 && x <= 4)) ? 239 : 255;
        return [value, value, 255, 255];
    }).flat();
    expect(Array.from(image.data)).toEqual(expected);
});
