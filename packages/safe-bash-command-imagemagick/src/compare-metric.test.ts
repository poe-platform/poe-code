import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });

it("rejects unknown metric names in every compare runner without writing output", async () => {
    const images = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()));
    const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files)
        await filesystem.writeFile(`/${name}`, bytes);
    for (const metric of ["bogus", "BoGuS", "", "RMSE ", "RootMeanSquared"]) {
        const args = ["-metric", metric, "a.png", "b.png", "diff.png"];
        const expected = { exitCode: 2, stdout: "", stderr: `compare: unrecognized metric type '${metric}'\n` };
        expect(await runCompareCli(args, files)).toEqual(expected);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(expected);
        expect(runCompareCliSync(args, files)).toEqual(expected);
    }
    expect(files.has("diff.png")).toBe(false);
    await expect(filesystem.readFile("/diff.png")).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(native.error !== undefined)("matches native ImageMagick rejection of an unknown metric", async () => {
    const images = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()));
    const reference = spawnSync("magick", ["compare", "-metric", "bogus", ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
    const result = await runCompareCli(["-metric", "bogus", "a.png", "b.png", "null:"], new Map([["a.png", images[0]!], ["b.png", images[1]!]]));
    expect(reference.status).toBe(2);
    expect(reference.stderr).toContain("unrecognized metric type");
    expect(reference.stderr).toContain("bogus");
    expect(result.exitCode).toBe(reference.status);
    expect(result.stderr).toContain("unrecognized metric type 'bogus'");
});

for (const metric of ["AE", "MAE", "MSE", "RMSE", "PAE", "PSNR", "SSIM", "DSSIM", "NCC", "DPC", "PHASH"]) {
    it(`preserves ${metric} and case-insensitive metric names`, async () => {
        const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const files = new Map([["a.png", image]]);
        const args = ["a.png", "a.png", "null:"];
        const result = await runCompareCli(["-metric", metric, ...args], files);
        expect(result.exitCode).toBeLessThan(2);
        expect(await runCompareCli(["-metric", metric.toLowerCase(), ...args], files)).toEqual(result);
        if (metric === "RMSE") expect(await runCompareCli(args, files)).toEqual(result);
    });
}

for (const retained of [false, true]) {
    it(`treats Undefined as the default metric, retained=${retained}`, async () => {
        const images = await Promise.all(["102030ff8090a0ff", "102030ff8090f0ff"].map(hex =>
            sharp(Buffer.from(hex, "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
        for (const metric of ["undefined", "Undefined", "UNDEFINED"]) {
            for (const verbose of [[], ["-verbose"]]) {
                const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const input = retained ? { filesystem, cwd: "/" } : files;
                const args = [...verbose, "a.png", "b.png", "null:"];
                const expected = await runCompareCli(args, input);
                expect(expected.exitCode).toBe(1);
                if (verbose.length === 0) expect(expected.stderr).toBe("7269.06 (0.110919)");
                expect(await runCompareCli(["-metric", "MAE", "-metric", metric, ...args], input)).toEqual(expected);
                expect(runCompareCliSync(["-metric", metric, ...args], files)).toEqual(expected);
                expect([...files.keys()]).toEqual(["a.png", "b.png"]);
                expect(await filesystem.readdir("/")).toEqual([{ name: "a.png", type: "file" }, { name: "b.png", type: "file" }]);
            }
        }
    });
}
