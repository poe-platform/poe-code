import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native PNG24: three black polygons on a 96x48 white canvas, rising 4px over 72px.
const input = readFileSync(new URL("./fixtures/deskew-rounding.png", import.meta.url));
for (const background of ["red", "none", "white"]) {
    it.each(["buffered", "retained", "sync"])(`matches native deskew edge samples on ${background} (%s)`, async mode => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-background", background, "-deskew", "40%"];
        const args = ["/input.png", ...options, "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const actual = decodeImage(result.stdoutBytes!);
        expect([actual.width, actual.height]).toEqual([101, 56]);
        const offset = (51 * actual.width + 58) * 4;
        expect([...actual.data.slice(offset, offset + 4)]).toEqual(background === "red" ? [255, 128, 128, 255] : background === "none" ? [255, 255, 255, 128] : [255, 255, 255, 255]);
        if (background === "none") expect([...actual.data.slice(81 * 4, 82 * 4)]).toEqual([0, 0, 0, 0]);
        const reference = spawnSync("magick", ["-", ...options, "png:-"], { input });
        if (!reference.error) {
            expect(reference.status, reference.stderr.toString()).toBe(0);
            expect(actual.data).toEqual(decodeImage(reference.stdout).data);
        }
    });
}
