import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";

const source = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n");
const alphaSource = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Uint8Array.of(255, 0, 0, 128, 255, 0, 0, 128, 0, 0, 255, 128)
]);
// ImageMagick 7.1.2-35 Q16-HDRI, using the same source bytes and options.
const cases = [
    { space: "HSL", depth: 8, alpha: false, expected: "             2: (0,100%,50%) #00FF80 hsl(0,100%,50%)\n             1: (240,100%,50%) #AAFF80 hsl(240,100%,50%)\n" },
    { space: "HSL", depth: 8, alpha: true, expected: "             2: (0,100%,50%,128) #00FF8080 hsla(0,100%,50%,0.501961)\n             1: (240,100%,50%,128) #AAFF8080 hsla(240,100%,50%,0.501961)\n" },
    { space: "HSL", depth: 16, alpha: false, expected: "             2: (0,100%,50%) #0000FFFF8000 hsl(0,100%,50%)\n             1: (240,100%,50%) #AAAAFFFF8000 hsl(240,100%,50%)\n" },
    { space: "HSL", depth: 16, alpha: true, expected: "             2: (0,100%,50%,32896) #0000FFFF80008080 hsla(0,100%,50%,0.501961)\n             1: (240,100%,50%,32896) #AAAAFFFF80008080 hsla(240,100%,50%,0.501961)\n" },
    { space: "HSV", depth: 8, alpha: false, expected: "             2: (0,100%,100%) #00FFFF hsv(0,100%,100%)\n             1: (240,100%,100%) #AAFFFF hsv(240,100%,100%)\n" },
    { space: "HSV", depth: 8, alpha: true, expected: "             2: (0,100%,100%,128) #00FFFF80 hsva(0,100%,100%,0.501961)\n             1: (240,100%,100%,128) #AAFFFF80 hsva(240,100%,100%,0.501961)\n" },
    { space: "HSV", depth: 16, alpha: false, expected: "             2: (0,100%,100%) #0000FFFFFFFF hsv(0,100%,100%)\n             1: (240,100%,100%) #AAAAFFFFFFFF hsv(240,100%,100%)\n" },
    { space: "HSV", depth: 16, alpha: true, expected: "             2: (0,100%,100%,32896) #0000FFFFFFFF8080 hsva(0,100%,100%,0.501961)\n             1: (240,100%,100%,32896) #AAAAFFFFFFFF8080 hsva(240,100%,100%,0.501961)\n" },
    { space: "XYZ", depth: 8, alpha: false, expected: "             1: (18.0493,7.22005,95.0497) #2E12F2 xyz(18.0493,7.22005,95.0497)\n             2: (41.2396,21.2586,1.92972) #693605 xyz(41.2396,21.2586,1.92972)\n" },
    { space: "XYZ", depth: 8, alpha: true, expected: "             1: (18.0493,7.22005,95.0497,128) #2E12F280 xyza(18.0493,7.22005,95.0497,0.501961)\n             2: (41.2396,21.2586,1.92972,128) #69360580 xyza(41.2396,21.2586,1.92972,0.501961)\n" },
    { space: "XYZ", depth: 16, alpha: false, expected: "             1: (4638.66,1855.55,24427.8) #2E35127CF353 xyz(18.0493,7.22005,95.0497)\n             2: (10598.6,5463.47,495.938) #6992366C04F1 xyz(41.2396,21.2586,1.92972)\n" },
    { space: "XYZ", depth: 16, alpha: true, expected: "             1: (4638.66,1855.55,24427.8,32896) #2E35127CF3538080 xyza(18.0493,7.22005,95.0497,0.501961)\n             2: (10598.6,5463.47,495.938,32896) #6992366C04F18080 xyza(41.2396,21.2586,1.92972,0.501961)\n" },
    { space: "Lab", depth: 8, alpha: false, expected: "             1: (82.3719,206.692,-107.863) #52CF14 cielab(32.3027,79.1923,-107.863)\n             2: (135.74,207.614,67.22) #88D0C3 cielab(53.2314,80.1144,67.22)\n" },
    { space: "Lab", depth: 8, alpha: true, expected: "             1: (82.3719,206.692,-107.863,128) #52CF1480 cielaba(32.3027,79.1923,-107.863,0.501961)\n             2: (135.74,207.614,67.22,128) #88D0C380 cielaba(53.2314,80.1144,67.22,0.501961)\n" },
    { space: "Lab", depth: 16, alpha: false, expected: "             1: (21169.6,53119.9,-27720.9) #52B2CF8013B7 cielab(32.3027,79.1923,-107.863)\n             2: (34885.2,53356.9,17275.5) #8845D06DC37B cielab(53.2314,80.1144,67.22)\n" },
    { space: "Lab", depth: 16, alpha: true, expected: "             1: (21169.6,53119.9,-27720.9,32896) #52B2CF8013B78080 cielaba(32.3027,79.1923,-107.863,0.501961)\n             2: (34885.2,53356.9,17275.5,32896) #8845D06DC37B8080 cielaba(53.2314,80.1144,67.22,0.501961)\n" },
    { space: "Luv", depth: 8, alpha: false, expected: "             1: (82.3719,89.7523,9.38413) #525A09 luv(82.3719,89.7523,9.38413)\n             2: (135.74,222.63,172.999) #88DFAD luv(135.74,222.63,172.999)\n" },
    { space: "Luv", depth: 8, alpha: true, expected: "             1: (82.3719,89.7523,9.38413,128) #525A0980 luva(82.3719,89.7523,9.38413,0.501961)\n             2: (135.74,222.63,172.999,128) #88DFAD80 luva(135.74,222.63,172.999,0.501961)\n" },
    { space: "Luv", depth: 16, alpha: false, expected: "             1: (21169.6,23066.3,2411.72) #52B25A1A096C luv(82.3719,89.7523,9.38413)\n             2: (34885.2,57216,44460.7) #8845DF80ADAD luv(135.74,222.63,172.999)\n" },
    { space: "Luv", depth: 16, alpha: true, expected: "             1: (21169.6,23066.3,2411.72,32896) #52B25A1A096C8080 luva(82.3719,89.7523,9.38413,0.501961)\n             2: (34885.2,57216,44460.7,32896) #8845DF80ADAD8080 luva(135.74,222.63,172.999,0.501961)\n" },
    { space: "YCbCr", depth: 8, alpha: false, expected: "             1: (29.1592,255,106.765) #1DFF6B ycbcr(29.1592,255,106.765)\n             2: (76.2039,84.4721,255) #4C54FF ycbcr(76.2039,84.4721,255)\n" },
    { space: "YCbCr", depth: 8, alpha: true, expected: "             1: (29.1592,255,106.765,128) #1DFF6B80 ycbcra(29.1592,255,106.765,0.501961)\n             2: (76.2039,84.4721,255,128) #4C54FF80 ycbcra(76.2039,84.4721,255,0.501961)\n" },
    { space: "YCbCr", depth: 16, alpha: false, expected: "             1: (7493.93,65535,27438.7) #1D46FFFF6B2F ycbcr(29.1592,255,106.765)\n             2: (19584.4,21709.3,65535) #4C8054CDFFFF ycbcr(76.2039,84.4721,255)\n" },
    { space: "YCbCr", depth: 16, alpha: true, expected: "             1: (7493.93,65535,27438.7,32896) #1D46FFFF6B2F8080 ycbcra(29.1592,255,106.765,0.501961)\n             2: (19584.4,21709.3,65535,32896) #4C8054CDFFFF8080 ycbcra(76.2039,84.4721,255,0.501961)\n" },
    { space: "OHTA", depth: 8, alpha: false, expected: "             1: (84.9991,0.00194553,63.7519) #550040 ohta(84.9991,0.00194553,63.7519)\n             2: (84.9991,255,63.7519) #55FF40 ohta(84.9991,255,63.7519)\n" },
    { space: "OHTA", depth: 8, alpha: true, expected: "             1: (84.9991,0.00194553,63.7519,128) #55004080 ohtaa(84.9991,0.00194553,63.7519,0.501961)\n             2: (84.9991,255,63.7519,128) #55FF4080 ohtaa(84.9991,255,63.7519,0.501961)\n" },
    { space: "OHTA", depth: 16, alpha: false, expected: "             1: (21844.8,0.5,16384.2) #555500014000 ohta(84.9991,0.00194553,63.7519)\n             2: (21844.8,65535,16384.2) #5555FFFF4000 ohta(84.9991,255,63.7519)\n" },
    { space: "OHTA", depth: 16, alpha: true, expected: "             1: (21844.8,0.5,16384.2,32896) #5555000140008080 ohtaa(84.9991,0.00194553,63.7519,0.501961)\n             2: (21844.8,65535,16384.2,32896) #5555FFFF40008080 ohtaa(84.9991,255,63.7519,0.501961)\n" }
];

for (const retained of [false, true]) {
    it.each(cases)(`formats $space histogram rows at depth $depth, alpha=$alpha (retained=${retained})`, async ({ space, depth, alpha, expected }) => {
        const bytes = alpha ? alphaSource : source;
        const filesystem = new MemoryFileSystem(), files = new Map([["in.ppm", bytes]]);
        await filesystem.writeFile("/in.ppm", bytes);
        const input = retained ? { filesystem, cwd: "/" } : files;
        const args = ["in.ppm", "-depth", String(depth), "-colorspace", space, "-format", "%c"];
        expect(await runConvertCli([...args, "histogram:info:"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}

it("uses the same active-color histogram rows in sync, streamed, file, and saved-comment output", async () => {
    const expected = cases[0]!.expected;
    const filesystem = new MemoryFileSystem(), files = new Map([["in.ppm", source]]), chunks: Uint8Array[] = [];
    await filesystem.writeFile("/in.ppm", source);
    const args = ["in.ppm", "-colorspace", "HSL", "-format", "%c"];
    expect(runMagickCliSync([...args, "histogram:info:"], files)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    expect(await runConvertCli([...args, "histogram:info:"], { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } } })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(expected);
    for (const input of [files, { filesystem, cwd: "/" }]) {
        expect(await runConvertCli([...args, "histogram:info:out.txt"], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(new TextDecoder().decode(input === files ? files.get("out.txt") : await filesystem.readFile("/out.txt"))).toBe(expected);
        expect(await runConvertCli([...args, "histogram:out.miff"], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(await runConvertCli(["out.miff", "-format", "%c", "info:"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    }
});

for (const retained of [false, true]) {
    it(`keeps separate source bins when rounded color rows are identical (retained=${retained})`, async () => {
        const bytes = new TextEncoder().encode("P3\n2 1\n255\n250 150 50 250 151 50\n");
        const filesystem = new MemoryFileSystem(), files = new Map([["in.ppm", bytes]]);
        await filesystem.writeFile("/in.ppm", bytes);
        const result = await runConvertCli(["in.ppm", "-colorspace", "HSL", "-precision", "1", "-format", "%c", "histogram:info:"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const rows = result.stdout.trim().split("\n").map(row => row.trim());
        expect(rows).toHaveLength(2);
        expect(rows[0]).toBe(rows[1]);
        expect(rows[0]).toContain("1: (3e+01,1e+02%,6e+01%) #15F396");
    });
}

for (const retained of [false, true]) {
    it.each([
        { space: "sRGB", expected: "             1: (0,0,255) #0000FF blue\n             2: (255,0,0) #FF0000 red\n" },
        { space: "CMYK", expected: "             2: (0,255,255,0) #00FFFF00 cmyk(0,255,255,0)\n             1: (255,255,0,0) #FFFF0000 cmyk(255,255,0,0)\n" }
    ])(`preserves $space formatting after MIFF roundtrip (retained=${retained})`, async ({ space, expected }) => {
        const filesystem = new MemoryFileSystem(), files = new Map([["in.ppm", source]]);
        await filesystem.writeFile("/in.ppm", source);
        const input = retained ? { filesystem, cwd: "/" } : files;
        expect(await runConvertCli(["in.ppm", "-colorspace", space, "out.miff"], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(await runConvertCli(["out.miff", "-format", "%c", "histogram:info:"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
