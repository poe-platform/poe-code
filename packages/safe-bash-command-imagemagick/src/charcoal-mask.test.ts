import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI, 5x4 RGB8 input.
const cases: [string[], string][] = [
    [["-colorspace", "Gray", "-region", "2x2+1+1"], "111111ff5e5e5effabababff404040ff8d8d8dffc7c7c7ff848484ff7c7c7cffc0c0c0ff565656ff909090ff5b5b5bff979797ffbfbfbfff1f1f1fff595959ffa6a6a6ff3b3b3bff888888ffc2c2c2ff"],
    [["-colorspace", "Gray", "-region", "5x4+0+0"], "ffffffffe1e1e1ff8d8d8dff4e4e4eff080808ff3b3b3bff898989ff959595ff757575ff858585ff000000ff464646ff959595ff909090ff8f8f8fff818181ff646464ffb5b5b5ffa4a4a4ff232323ff"],
    [["-region", "2x2+1+1"], "111111ff363636ff5b5b5bff808080ffa5a5a5ffcacacaff5b5b5bff454545ff393939ff5e5e5eff838383ff3e3e3eff6c6c6cfff2f2f2ff171717ff3c3c3cff616161ff868686ffabababffd0d0d0ff"],
    [["-write-mask", "mask.png"], "111111ff363636ff6b6b6bff5d5d5dff484848ffcacacaffefefefff616161ff666666ff7c7c7cff838383ffa8a8a8ff6e6e6eff717171ff808080ff3c3c3cff616161ff8e8e8eff7c7c7cff565656ff"],
    [["-region", "3x4+2+0"], "111111ff363636ff6b6b6bff5d5d5dff484848ffcacacaffefefefff616161ff666666ff7c7c7cff838383ffa8a8a8ff6e6e6eff717171ff808080ff3c3c3cff616161ff8e8e8eff7c7c7cff565656ff"],
    [["-read-mask", "mask.png"], "f3f3f3ffcdcdcdff7a7a7aff393939ff0d0d0dff424242ff5d5d5dff4a4a4aff4b4b4bff7b7b7bff1e1e1eff3c3c3cff515151ff5f5f5fff7e7e7effa4a4a4ff878787ff949494ff727272ff2a2a2aff"],
    [["-region", "5x4+0+0"], "f3f3f3ffcdcdcdff7a7a7aff393939ff0d0d0dff424242ff5d5d5dff4a4a4aff4b4b4bff7b7b7bff1e1e1eff3c3c3cff515151ff5f5f5fff7e7e7effa4a4a4ff878787ff949494ff727272ff2a2a2aff"],
];
for (const mode of ["sync", "public"] as const) it.each(cases)(`renders charcoal with %j via ${mode}`, async (selection, expected) => {
    const png = (mask: boolean) => encodeImage({ width: 5, height: 4, data: Uint8Array.from({ length: 80 }, (_, i) => i % 4 === 3 ? 255 : mask ? (Math.floor(i / 4) % 5 < 2 ? 255 : 0) : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    const files = new Map([["input.png", png(false)], ["mask.png", png(true)], ["out.png", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = ["input.png", ...selection, "-charcoal", "0x1", "+region", "+write-mask", "+read-mask", "PNG32:out.png"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    const actual = decodeImage(mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png")).data;
    expect(Buffer.from(actual).toString("hex")).toBe(expected);
});

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for a varying grayscale mask.
for (const mode of ["sync", "public"] as const) it.each([
    ["gradient:black-white", "df80f1"],
    ["gradient:#202020-#909090", "c27483"],
    ["xc:black", "c0258a"],
    ["xc:white", "1382f1"],
    ["xc:#808080", "7f8080"],
])(`blends charcoal mask %s via ${mode}`, async (mask, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("13385d82a7ccf1163b", "hex")]);
    const files = new Map([["in.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["in.ppm", "-size", "3x1", "-write-mask", mask!, "-charcoal", "1x1", "-depth", "8", "gray:out"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "sync" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
});
