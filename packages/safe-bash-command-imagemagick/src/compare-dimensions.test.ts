import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
for (const [width, height] of [[2, 2], [3, 1], [2, 3], [1026, 1]] as const) {
    for (const metric of ["AE", "RMSE"]) {
        it(`compares 3x2 against ${width}x${height} with ${metric} in both storage modes`, async () => {
            const images = await Promise.all(([[3, 2], [width, height]] as const).map(([w, h]) =>
                sharp({ create: { width: w, height: h, channels: 3, background: "red" } }).png().toBuffer()));
            const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files)
                await filesystem.writeFile(`/${name}`, bytes);
            for (const input of [files, { filesystem, cwd: "/" }]) {
                const result = await runCompareCli(["-metric", metric, "a.png", "b.png", "diff.png"], input);
                expect(result).toMatchObject({ exitCode: 0, stderr: "0 (0)" });
                const output = input === files ? files.get("diff.png")! : await filesystem.readFile("/diff.png");
                expect(await sharp(output).metadata()).toMatchObject({ width: Math.max(3, width), height: Math.max(2, height) });
                const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
                expect(Array.from(pixels)).toEqual(Array.from({ length: Math.max(3, width) * Math.max(2, height) }, () => [255, 204, 204, 255]).flat());
            }
            if (!native.error) {
                const result = spawnSync("magick", ["compare", "-metric", metric, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
                expect(result.status).toBe(0);
                expect(result.stderr.trim()).toBe("0 (0)");
            }
        });
    }
}

it("matches native edge pixels outside the overlap", async () => {
    const a = await sharp(Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const b = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    for (const images of [[a, b], [b, a]]) {
        const result = await runCompareCli(["-metric", "AE", "a.png", "b.png", "null:"], new Map([["a.png", images[0]!], ["b.png", images[1]!]]));
        expect(result).toMatchObject({ exitCode: 1, stderr: "0.666667 (0.222222)" });
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", "-metric", "AE", ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes!).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(reference.status).toBe(result.exitCode);
            expect(reference.stderr.trim()).toBe(result.stderr.trim());
        }
    }
});
