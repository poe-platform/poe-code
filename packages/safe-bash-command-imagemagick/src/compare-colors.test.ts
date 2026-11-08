import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const cases = [
    { args: [], pixels: [224, 224, 224, 255, 213, 20, 44, 255] },
    { args: ["-highlight-color", "#00ff00"], pixels: [224, 224, 224, 255, 0, 255, 0, 255] },
    { args: ["-lowlight-color", "#0000ff"], pixels: [0, 0, 255, 255, 213, 20, 44, 255] },
    { args: ["-highlight-color", "#00ff0080", "-lowlight-color", "#0000ff80"], pixels: [50, 50, 178, 255, 50, 178, 50, 255] },
    { args: ["-compose", "Src"], pixels: [255, 255, 255, 204, 241, 0, 30, 204] },
    { args: ["-compose", "Src", "-highlight-color", "#00ff0080", "-lowlight-color", "#0000ff80"], pixels: [0, 0, 255, 128, 0, 255, 0, 128] },
];
async function images() {
    return Promise.all([[100, 100, 100, 255, 100, 100, 100, 255], [100, 100, 100, 255, 200, 20, 20, 255]].map(pixels =>
        sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
}
for (const { args, pixels } of cases) {
    it(`matches native difference pixels in memory and retained execution: ${args.join(" ") || "defaults"}`, async () => {
        const [a, b] = await images();
        const files = new Map([["a.png", a!], ["b.png", b!]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files)
            await fs.writeFile(`/${name}`, bytes);
        for (const input of [files, { filesystem: fs, cwd: "/" }]) {
            expect(await runCompareCli(["-metric", "AE", ...args, "a.png", "b.png", "diff.png"], input))
                .toMatchObject({ exitCode: 1, stderr: "0.254902 (0.127451)\n" });
            expect([...decodeImage(input === files ? files.get("diff.png")! : await fs.readFile("/diff.png")).data]).toEqual(pixels);
        }
    });
}
const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies difference-color references against native ImageMagick", async () => {
    const inputs = (await images()).map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    for (const { args, pixels } of cases) {
        const result = spawnSync("magick", ["compare", "-metric", "AE", ...args, ...inputs, "png:-"]);
        expect(result.status).toBe(1);
        expect(result.stderr.toString().trim()).toBe("0.254902 (0.127451)");
        expect([...decodeImage(result.stdout).data]).toEqual(pixels);
    }
});
