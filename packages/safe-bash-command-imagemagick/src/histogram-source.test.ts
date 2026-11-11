import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from("ff0000".repeat(4) + "00ff00".repeat(2) + "0000ff000000", "hex")]);
// ImageMagick 7.1.2-35 Q16-HDRI, direct histogram text (not the plot).
const rows = {
    Gray: [
        "1: (0,0,0) #000000 gray(0)",
        "1: (18.4074,18.4074,18.4074) #121212 gray(7.2186%)",
        "4: (54.2273,54.2273,54.2273) #363636 gray(21.2656%)",
        "2: (182.365,182.365,182.365) #B6B6B6 gray(71.5158%)"
    ],
    CMYK: [
        "1: (0,0,0,255) #000000FF cmyk(0,0,0,255)",
        "4: (0,255,255,0) #00FFFF00 cmyk(0,255,255,0)",
        "2: (255,0,255,0) #FF00FF00 cmyk(255,0,255,0)",
        "1: (255,255,0,0) #FFFF0000 cmyk(255,255,0,0)"
    ],
    sRGB: [
        "1: (0,0,0) #000000 black",
        "1: (0,0,255) #0000FF blue",
        "2: (0,255,0) #00FF00 lime",
        "4: (255,0,0) #FF0000 red"
    ]
};
for (const mode of ["sync", "memory", "retained", "streamed"] as const) {
    it.each(["Gray", "CMYK", "sRGB"] as const)(`reports source %s histogram samples (${mode})`, async space => {
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const chunks: Uint8Array[] = [];
        const args = ["in.ppm", "-colorspace", space, "-format", "%c", "histogram:info:"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args,
            mode === "memory" ? files : { filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } } } : {}) });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = mode === "streamed" ? Buffer.concat(chunks).toString() : result.stdout;
        expect(output.trim().split("\n").map(line => line.trim())).toEqual(rows[space]);
    });
}

for (const retained of [false, true]) {
    it.each([
        { name: "16-bit Gray", args: ["in.ppm", "-colorspace", "Gray", "-depth", "16"], expected: [
            "1: (0,0,0) #000000000000 gray(0)",
            "1: (4730.71,4730.71,4730.71) #127B127B127B gray(7.2186%)",
            "4: (13936.4,13936.4,13936.4) #367036703670 gray(21.2656%)",
            "2: (46867.9,46867.9,46867.9) #B714B714B714 gray(71.5158%)"
        ] },
        { name: "fractional CMYK", args: ["xc:#804020", "-colorspace", "CMYK"], expected: [
            "1: (0,32767.5,49151.2,32639) #00008000BFFF7F7F cmyk(0,127.5,191.25,127)"
        ] },
        { name: "distinct inks with identical RGB", args: ["xc:cmyk(0,0,0,255)", "xc:cmyk(255,255,255,0)", "+append", "-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], expected: [
            "1: (0,0,0,65535,32768) #000000000000FFFF8000 cmyka(0,0,0,255,0.500008)",
            "1: (65535,65535,65535,0,32768) #FFFFFFFFFFFF00008000 cmyka(255,255,255,0,0.500008)"
        ] },
        { name: "fractional grayscale", args: ["xc:gray(50%)"], expected: [
            "1: (32767.5,32767.5,32767.5) #800080008000 gray(50%)"
        ] },
        ...(["Gray", "CMYK"] as const).map(space => ({ name: `${space} alpha`, args: ["in.ppm", "-colorspace", space, "-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], expected: rows[space].map(row => row.replace(") #", ",127.502) #").replace(` ${space.toLowerCase()}(`, `80 ${space.toLowerCase()}a(`).slice(0, -1) + ",0.500008)") }))
    ])(`preserves $name histogram samples (retained=${retained})`, async ({ args, expected }) => {
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = retained ? await runConvertCli([...args, "-format", "%c", "histogram:info:out.txt"], { filesystem, cwd: "/" }) : runConvertCliSync([...args, "-format", "%c", "histogram:info:out.txt"], files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = new TextDecoder().decode(retained ? await filesystem.readFile("/out.txt") : files.get("out.txt")!);
        expect(output.trim().split("\n").map(line => line.trim())).toEqual(expected);
    });
}
