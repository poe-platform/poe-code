import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
for (const custom of [false, true]) {
    it(`matches Src difference pixels with ${custom ? "custom" : "default"} colors in both storage modes`, async () => {
        const images = await Promise.all([
            [100, 100, 100, 255, 100, 100, 100, 255],
            [100, 100, 100, 255, 200, 20, 20, 255],
        ].map(pixels => sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files)
            await filesystem.writeFile(`/${name}`, bytes);
        const options = ["-metric", "AE", "-compose", "Src", ...(custom ? ["-highlight-color", "rgba(10,20,30,0.4)", "-lowlight-color", "rgba(40,50,60,0.6)"] : [])];
        const expected = custom ? [40, 50, 60, 153, 10, 20, 30, 102] : [255, 255, 255, 204, 241, 0, 30, 204];
        for (const input of [files, { filesystem, cwd: "/" }]) {
            expect(await runCompareCli([...options, "a.png", "b.png", "diff.png"], input))
                .toMatchObject({ exitCode: 1, stderr: "0.254902 (0.127451)" });
            const output = input === files ? files.get("diff.png")! : await filesystem.readFile("/diff.png");
            expect(Array.from(await sharp(output).ensureAlpha().raw().toBuffer())).toEqual(expected);
        }
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", ...options, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
            expect(reference.status).toBe(1);
            expect(reference.stderr.toString().trim()).toBe("0.254902 (0.127451)");
            expect(Array.from(await sharp(reference.stdout).ensureAlpha().raw().toBuffer())).toEqual(expected);
        }
    });
}
