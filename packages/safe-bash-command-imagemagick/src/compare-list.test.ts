import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "magick", "magick-sync"] as const) {
    it.each(["channel", "metric"])(`lists %s before reading operands in ${mode}`, async list => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const operands of [[], ["missing-a.png", "missing-b.png", "out.png"]]) {
            const args = ["-list", list, ...operands];
            const result = mode === "buffered" ? await runCompareCli(args, files)
                : mode === "retained" ? await runCompareCli(args, { filesystem, cwd: "/" })
                : mode === "sync" ? runCompareCliSync(args, files)
                : mode === "magick" ? await runMagickCli(["compare", ...args], files)
                : runMagickCliSync(["compare", ...args], files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout.split("\n")).toEqual(expect.arrayContaining(list === "channel"
                ? ["Red", "Green", "Blue", "Alpha"] : ["AE", "RMSE", "SSIM", "PHASH"]));
            const native = spawnSync("magick", ["compare", ...args], { encoding: "utf8" });
            if (!native.error) {
                expect(native.status).toBe(0);
                expect(result.stdout).toBe(native.stdout);
            }
            expect(files.size).toBe(0);
            await expect(filesystem.readFile("/out.png")).rejects.toThrow();
        }
    });
}
