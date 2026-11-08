import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI, -modulate VALUE -depth 8 rgba:-.
const samples: [string, string, string, number[]][] = [
    ["HWB", "#80808080", "100,100,100", [128, 128, 128, 128]],
    ["HSB", "#1964dc80", "80,60,120", [103, 82, 176, 128]],
    ["HSB", "#80402080", "80,60,120", [102, 99, 56, 128]],
    ["HSB", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HSB", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HSB", "#ff000080", "80,60,120", [204, 155, 82, 128]],
    ["HSB", "#1964dc80", "150,140,40", [0, 255, 0, 128]],
    ["HSB", "#1964dc80", "100,0,100", [220, 220, 220, 128]],
    ["HSB", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HSV", "#1964dc80", "80,60,120", [103, 82, 176, 128]],
    ["HSV", "#80402080", "80,60,120", [102, 99, 56, 128]],
    ["HSV", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HSV", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HSV", "#ff000080", "80,60,120", [204, 155, 82, 128]],
    ["HSV", "#1964dc80", "150,140,40", [0, 255, 0, 128]],
    ["HSV", "#1964dc80", "100,0,100", [220, 220, 220, 128]],
    ["HSV", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HSL", "#1964dc80", "80,60,120", [71, 51, 145, 128]],
    ["HSL", "#80402080", "80,60,120", [87, 84, 41, 128]],
    ["HSL", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HSL", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HSL", "#ff000080", "80,60,120", [163, 114, 41, 128]],
    ["HSL", "#1964dc80", "150,140,40", [134, 255, 104, 128]],
    ["HSL", "#1964dc80", "100,0,100", [123, 123, 123, 128]],
    ["HSL", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HWB", "#1964dc80", "80,60,120", [61, 15, 227, 128]],
    ["HWB", "#80402080", "80,60,120", [153, 144, 19, 128]],
    ["HWB", "#80808080", "80,60,120", [153, 123, 77, 128]],
    ["HWB", "#00000080", "80,60,120", [51, 31, 0, 128]],
    ["HWB", "#ff000080", "80,60,120", [255, 153, 0, 128]],
    ["HWB", "#1964dc80", "150,140,40", [66, 203, 35, 128]],
    ["HWB", "#1964dc80", "100,0,100", [0, 85, 220, 128]],
    ["HWB", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HSI", "#1964dc80", "80,60,120", [74, 49, 153, 128]],
    ["HSI", "#80402080", "80,60,120", [71, 68, 39, 128]],
    ["HSI", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HSI", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HSI", "#ff000080", "80,60,120", [104, 73, 27, 128]],
    ["HSI", "#1964dc80", "150,140,40", [75, 255, 0, 128]],
    ["HSI", "#1964dc80", "100,0,100", [115, 115, 115, 128]],
    ["HSI", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HCL", "#1964dc80", "80,60,120", [77, 52, 169, 128]],
    ["HCL", "#80402080", "80,60,120", [72, 69, 15, 128]],
    ["HCL", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HCL", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HCL", "#ff000080", "80,60,120", [114, 53, 0, 128]],
    ["HCL", "#1964dc80", "150,140,40", [12, 235, 0, 128]],
    ["HCL", "#1964dc80", "100,0,100", [91, 91, 91, 128]],
    ["HCL", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["HCLp", "#1964dc80", "80,60,120", [77, 52, 169, 128]],
    ["HCLp", "#80402080", "80,60,120", [72, 69, 15, 128]],
    ["HCLp", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["HCLp", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["HCLp", "#ff000080", "80,60,120", [94, 56, 0, 128]],
    ["HCLp", "#1964dc80", "150,140,40", [39, 213, 0, 128]],
    ["HCLp", "#1964dc80", "100,0,100", [91, 91, 91, 128]],
    ["HCLp", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["LCHab", "#1964dc80", "80,60,120", [76, 87, 77, 128]],
    ["LCHab", "#80402080", "80,60,120", [20, 68, 107, 128]],
    ["LCHab", "#80808080", "80,60,120", [0, 125, 80, 128]],
    ["LCHab", "#00000080", "80,60,120", [0, 67, 76, 128]],
    ["LCHab", "#ff000080", "80,60,120", [112, 98, 82, 128]],
    ["LCHab", "#1964dc80", "150,140,40", [0, 255, 250, 128]],
    ["LCHab", "#1964dc80", "100,0,100", [94, 137, 0, 128]],
    ["LCHab", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["LCHuv", "#1964dc80", "80,60,120", [91, 81, 96, 128]],
    ["LCHuv", "#80402080", "80,60,120", [50, 67, 86, 128]],
    ["LCHuv", "#80808080", "80,60,120", [23, 117, 55, 128]],
    ["LCHuv", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["LCHuv", "#ff000080", "80,60,120", [137, 91, 5, 128]],
    ["LCHuv", "#1964dc80", "150,140,40", [0, 255, 200, 128]],
    ["LCHuv", "#1964dc80", "100,0,100", [164, 151, 0, 128]],
    ["LCHuv", "#ff000080", "100,100,100", [255, 0, 0, 128]],
    ["unknown", "#1964dc80", "80,60,120", [71, 51, 145, 128]],
    ["unknown", "#80402080", "80,60,120", [87, 84, 41, 128]],
    ["unknown", "#80808080", "80,60,120", [102, 102, 102, 128]],
    ["unknown", "#00000080", "80,60,120", [0, 0, 0, 128]],
    ["unknown", "#ff000080", "80,60,120", [163, 114, 41, 128]],
    ["unknown", "#1964dc80", "150,140,40", [134, 255, 104, 128]],
    ["unknown", "#1964dc80", "100,0,100", [123, 123, 123, 128]],
    ["unknown", "#ff000080", "100,100,100", [255, 0, 0, 128]],
];
for (const mode of ["buffered", "command", "sync"] as const) {
    it.each(samples)(`modulates %s %s %s via ${mode}`, async (space, color, value, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", `xc:${color}`, "-define", `modulate:colorspace=${space}`, "-modulate", value, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

it("captures each modulation definition and restores HSL with +define", async () => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-size", "1x1", "xc:#1964dc", "-define", "modulate:colorspace=hSb", "-modulate", "80,60,120", "-write", "hsb.png", "+delete", "-size", "1x1", "xc:#1964dc", "+define", "modulate:colorspace", "-modulate", "80,60,120", "hsl.png"], files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(files.get("hsb.png")!).data]).toEqual([103, 82, 176, 255]);
    expect([...decodeImage(files.get("hsl.png")!).data]).toEqual([71, 51, 145, 255]);
});
