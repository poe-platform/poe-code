import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "@poe-code/image-ast";
import { runCompareCli } from "./index.js";

// Reference metrics from ImageMagick 7.1.2 (six significant digits).
const cases = [
    { a: "red", b: "cyan", fuzz: "0", expected: "6 (1)", status: 1 },
    { a: "red", b: "blue", fuzz: "0", expected: "4 (0.666667)", status: 1 },
    { a: "red", b: "#ff0001", fuzz: "0", expected: "0.00784314 (0.00130719)", status: 1 },
    { a: "red", b: "red", fuzz: "0", expected: "0 (0)", status: 0 },
    { a: "red", b: "#ff0001", fuzz: "10%", expected: "0 (0)", status: 0 },
    { a: "red", b: "#800001", fuzz: "10%", expected: "0.996078 (0.166013)", status: 1 },
    { a: "rgba(255,0,0,0.2)", b: "rgba(255,0,0,0.8)", fuzz: "0", expected: "1.8 (0.3)", status: 1 },
    { a: "rgba(255,0,0,0)", b: "rgba(0,0,255,0)", fuzz: "0", expected: "0 (0)", status: 0 },
];
for (const { a, b, fuzz, expected, status } of cases) {
    it(`matches AE reference for ${a} / ${b} with fuzz ${fuzz} in memory and retained execution`, async () => {
        const files = new Map<string, Uint8Array>();
        for (const [name, color] of [["a.png", a], ["b.png", b]] as const)
            files.set(name, await sharp({ create: { width: 3, height: 2, channels: color.startsWith("rgba") ? 4 : 3, background: color } }).png().toBuffer());
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files)
            await fs.writeFile(`/${name}`, bytes);
        const args = ["-metric", "AE", "-fuzz", fuzz, "a.png", "b.png", "null:"];
        for (const input of [files, { filesystem: fs, cwd: "/" }])
            expect(await runCompareCli(args, input)).toMatchObject({ exitCode: status, stdout: "", stderr: expected });
    });
}

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
it.skipIf(native.error !== undefined)("matches real ImageMagick AE reference metrics", async () => {
    expect(native.status).toBe(0);
    for (const { a, b, fuzz, expected, status } of cases) {
        const images = await Promise.all([a, b].map(background => sharp({ create: { width: 3, height: 2, channels: background.startsWith("rgba") ? 4 : 3, background } }).png().toBuffer()));
        const result = spawnSync("magick", ["compare", "-metric", "AE", "-fuzz", fuzz, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
        expect(result.status).toBe(status);
        expect(result.stderr.trim()).toBe(expected);
    }
});
