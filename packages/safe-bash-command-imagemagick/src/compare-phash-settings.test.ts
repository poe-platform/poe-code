import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI; a textured RGB image with a 4×4 edit.
for (const [definitions, score] of [
    [[], "10.0991"],
    [["phash:colorspaces=RGB"], "8.89713"],
    [["phash:colorspaces=sRGB"], "2.13229"],
    [["phash:normalize=true"], "2.24712"],
    [["phash:colorspaces=RGB", "phash:normalize=true"], "2.98281"],
    [["phash:colorspaces=RGB", "phash:normalize=false"], "8.89713"],
    [["phash:colorspaces=HSB,xyY"], "10.0991"],
    [["phash:colorspaces=RGB,RGB", "phash:normalize=yes"], "2.98281"],
] as const) {
    it(`honors ${definitions.join(", ") || "default PHASH"} across entry points`, async () => {
        const base = Uint8Array.from(Array.from({ length: 120 }, (_, i) => {
            const x = i % 12, y = Math.floor(i / 12);
            return [(x * 37 + y * 13) % 256, (y * 29 + x * 3) % 256, (x * 19 + y * 41) % 256];
        }).flat());
        const edit = base.slice();
        for (let y = 3; y < 7; y++) for (let x = 4; x < 8; x++) edit.set([233, 15, 110], (y * 12 + x) * 3);
        const images = await Promise.all([base, edit].map(data => sharp(data, { raw: { width: 12, height: 10, channels: 3 } }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const options = ["-metric", "PHASH", ...definitions.flatMap(value => ["-define", value])];
        for (const identical of [false, true]) {
            const args = [...options, "a.png", identical ? "a.png" : "b.png", "null:"];
            const value = identical ? "0" : score;
            const expected = { exitCode: identical ? 0 : 1, stdout: "", stderr: `${value} (${value})\n` };
            expect(runCompareCliSync(args, files)).toEqual(expected);
            expect(await runCompareCli(args, files)).toEqual(expected);
            expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(expected);
            expect(await runMagickCli(["compare", ...args], files)).toEqual(expected);
        }
    });
}

it("rejects unsupported PHASH spaces instead of silently using default hashes", async () => {
    expect(await runCompareCli(["-metric", "PHASH", "-define", "phash:colorspaces=bogus", "a.png", "b.png", "null:"], new Map()))
        .toEqual({ exitCode: 2, stdout: "", stderr: "compare: unsupported PHASH colorspaces 'bogus'\n" });
});
