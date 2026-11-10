import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { deskewPlan } from "./deskew.js";
import { runConvertCli, runConvertCliSync } from "./index.js";

it("uses positioned raster bounds and scales the input virtual canvas", () => {
    const plan = deskewPlan({ width: 96, height: 48, hasAlpha: false, virtualCanvas: { width: 120, height: 100, x: 14, y: 11 } }, -Math.atan(1 / 16), { r: 255, g: 255, b: 255, a: 255 });
    expect([plan.width, plan.height, plan.virtualCanvas]).toEqual([100, 56, { width: 125, height: 117, x: 14, y: 3 }]);
});

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable).each(["buffered", "retained", "sync"])("matches native positioned PNG deskew geometry and pixels (%s)", async mode => {
    for (const page of ["120x100+14+11", "120x100-14-11", "120x100+0+0"]) {
        const fixture = spawnSync("magick", ["-size", "96x48", "xc:white", "+antialias", "-fill", "black", "-stroke", "none", "-draw", "polygon 8,8 80,12 80,15 8,11", "-draw", "polygon 8,18 80,22 80,25 8,21", "-draw", "polygon 8,28 80,32 80,35 8,31", "-repage", page, "PNG24:-"]);
        expect(fixture.status, fixture.stderr.toString()).toBe(0);
        const input = new Uint8Array(fixture.stdout);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-deskew", "40%", "png:-"];
        const files = new Map([["/input.png", input]]);
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const reference = spawnSync("magick", ["-", "-deskew", "40%", "-depth", "8", "png:-"], { input });
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const actual = decodeImage(result.stdoutBytes!), expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height, actual.virtualCanvas], page).toEqual([expected.width, expected.height, expected.virtualCanvas]);
        expect(Math.max(...actual.data.map((v, i) => Math.abs(v - expected.data[i]!))), page).toBeLessThanOrEqual(2);
    }
});
