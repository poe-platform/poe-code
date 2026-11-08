import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runCompositeCli } from "./index.js";

const cases = [
    { destination: [20, 80, 180, 255, 150, 70, 40, 127, 40, 160, 80, 255], source: [20, 80, 180, 255, 151, 70, 40, 127, 200, 50, 10, 64], channels: 4 as const, fuzz: "2%", alpha: [0, 0, 255] },
    { destination: [100, 100, 100, 128], source: [136, 100, 100, 128], channels: 4 as const, fuzz: "5%", alpha: [128] },
    { destination: [100, 100, 100, 128], source: [135, 100, 100, 128], channels: 4 as const, fuzz: "5%", alpha: [0] },
    { destination: [100, 80, 60, 0], source: [200, 50, 10, 0], channels: 4 as const, fuzz: undefined, alpha: [0] },
    { destination: [20, 80, 180, 150, 70, 40, 40, 160, 80], source: [20, 80, 180, 151, 70, 40, 200, 50, 10], channels: 3 as const, fuzz: undefined, alpha: [0, 255, 255] },
    { destination: [20, 80, 180, 150, 70, 40, 40, 160, 80], source: [20, 80, 180, 151, 70, 40, 200, 50, 10], channels: 3 as const, fuzz: "2%", alpha: [0, 0, 255] },
    ...[undefined, "4%", "5%", "3276.75"].map(fuzz => ({ destination: [128, 64, 32, 128], source: [128, 64, 32, 144], channels: 4 as const, fuzz, alpha: [fuzz === undefined || fuzz === "4%" ? 128 : 0] })),
    { destination: [100, 100, 100], source: [118, 100, 100], channels: 3 as const, fuzz: "5%", alpha: [0] },
    { destination: [100, 100, 100], source: [119, 100, 100], channels: 3 as const, fuzz: "5%", alpha: [255] },
];

async function inputs(test: typeof cases[number]) {
    return Promise.all([test.destination, test.source].map(pixels => sharp(new Uint8Array(pixels), {
        raw: { width: pixels.length / test.channels, height: 1, channels: test.channels }
    }).png().toBuffer()));
}
function expected(test: typeof cases[number]) {
    return test.alpha.flatMap((alpha, pixel) => [...test.destination.slice(pixel * test.channels, pixel * test.channels + 3), alpha]);
}
for (const mode of ["buffered", "retained", "sync", "composite"] as const) {
    it.each(cases)(`ChangeMask ${mode} channels=$channels fuzz=$fuzz preserves RGB and masks matching pixels`, async test => {
        const [destination, source] = await inputs(test);
        const files = new Map([["/dst.png", destination!], ["/src.png", source!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const settings = [...(test.fuzz === undefined ? [] : ["-fuzz", test.fuzz]), "-compose", "ChangeMask"];
        const args = ["/dst.png", "/src.png", ...settings, "-composite", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "composite" ? await runCompositeCli([...settings, "/src.png", "/dst.png", "/out.png"], files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect([...decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected(test));
    });
}
const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies ChangeMask reference pixels with native ImageMagick", async () => {
    for (const test of cases) {
        const images = (await inputs(test)).map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
        const result = spawnSync("magick", [...images, ...(test.fuzz === undefined ? [] : ["-fuzz", test.fuzz]), "-compose", "ChangeMask", "-composite", "png:-"]);
        expect(result.status).toBe(0);
        expect([...decodeImage(result.stdout).data]).toEqual(expected(test));
    }
});
