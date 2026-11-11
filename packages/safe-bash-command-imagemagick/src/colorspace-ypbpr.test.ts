import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: red, muted green and blue PPM.
const ppm = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");
const cases: { name: string; args: string[]; hex?: string; text?: string }[] = [
    ...["4c4c4c5c5c5c1d1d1d", "545454707070ffffff", "ffffff5555556b6b6b"].map((hex, index) => ({
        name: `${"RGB"[index]} channel`, args: ["/in.ppm", "-colorspace", "YPbPr", "-channel", "RGB"[index]!, "-separate", "-depth", "8", "rgb:/out"], hex,
    })),
    { name: "sRGB round trip", args: ["/in.ppm", "-colorspace", "YPbPr", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { name: "sRGB channel control", args: ["/in.ppm", "-colorspace", "sRGB", "-channel", "R", "-separate", "-depth", "8", "rgb:/out"], hex: "ffffff202020000000" },
    { name: "case-insensitive repeated conversion with alpha", args: ["xc:#20804080", "-colorspace", "yPbPr", "-colorspace", "YPbPr", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "20804080" },
    { name: "pixel metadata", args: ["xc:red", "-colorspace", "YPbPr", "-format", "%[colorspace]|%[pixel:p{0,0}]", "info:/out"], text: "YPbPr|ypbpr(76.2039,84.4721,255)" },
];
for (const mode of ["buffered", "sync", "retained"]) it.each(cases)(`${mode}: $name`, async ({ args, hex, text }) => {
    const files = new Map<string, Uint8Array>([["/in.ppm", ppm]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", ppm);
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
    expect(output.toString(text === undefined ? "hex" : "utf8")).toBe(text ?? hex);
});
