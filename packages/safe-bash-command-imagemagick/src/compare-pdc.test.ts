import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const native = spawnSync("magick", ["-version"]);
const cases = [
    { name: "red versus blue", a: [255, 0, 0], b: [0, 0, 255], fuzz: "0%", expected: "6 (1)", status: 1 },
    { name: "identical", a: [255, 0, 0], b: [255, 0, 0], fuzz: "0%", expected: "0 (0)", status: 0 },
    { name: "unequal channel errors", a: [10, 20, 30], b: [20, 40, 30], fuzz: "0%" },
    { name: "one channel below tolerance", a: [10, 20, 30], b: [20, 40, 30], fuzz: "5%" },
    { name: "quantum tolerance", a: [10, 20, 30], b: [20, 40, 30], fuzz: "3276.75" },
    { name: "all channels below tolerance", a: [10, 20, 30], b: [20, 40, 30], fuzz: "10%", expected: "0 (0)", status: 0 },
    { name: "alpha errors", a: [100, 20, 30, 128], b: [120, 40, 30, 64], fuzz: "0%" },
    { name: "hidden RGB", a: [255, 0, 0, 0], b: [0, 0, 255, 0], fuzz: "0%", expected: "0 (0)", status: 0 },
    { name: "alpha only with one opaque input", a: [0, 0, 0], b: [0, 0, 0, 64], fuzz: "0%", expected: "0 (0)", status: 0 },
    { name: "negative tolerance", a: [10, 20, 30], b: [20, 40, 30], fuzz: "-10%", expected: "0 (0)", status: 0 },
    { name: "mixed alpha", a: [100, 20, 30], b: [120, 40, 30, 64], fuzz: "0%" }
];

for (const fixture of cases) {
    it(`implements PDC for ${fixture.name} in every runner`, async () => {
        const images = await Promise.all([fixture.a, fixture.b].map(pixel => sharp(
            Uint8Array.from(Array.from({ length: 6 }, () => pixel).flat()),
            { raw: { width: 3, height: 2, channels: pixel.length as 3 | 4 } }
        ).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["-metric", "PdC", "-fuzz", fixture.fuzz, "a.png", "b.png", "null:"];
        const result = await runCompareCli(args, files);
        expect(result.exitCode).toBeLessThan(2);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
        expect(runCompareCliSync(args, files)).toEqual(result);
        if (fixture.expected !== undefined) {
            expect(result.stderr.trim()).toBe(fixture.expected);
            expect(result.exitCode).toBe(fixture.status);
        }
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", ...args.slice(0, 4), ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(result.stderr.trim()).toBe(reference.stderr.trim());
            expect(result.exitCode).toBe(reference.status);
        }
    });
}
