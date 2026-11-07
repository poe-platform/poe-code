import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native PNG24 fixture: three sloping black bars on white, with lime bKGD.
const input = readFileSync(new URL("./fixtures/deskew-background.png", import.meta.url));
it.each(["buffered", "retained", "sync"])("inherits PNG deskew background and honors explicit overrides (%s)", async mode => {
    expect(decodeImage(input).backgroundColor).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    for (const options of [[], ["-background", "white"]]) {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "-deskew", "40%", "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(result.stdoutBytes!);
        expect([output.width, output.height]).toEqual([101, 56]);
        expect([...output.data.slice(0, 4)]).toEqual(options.length ? [255, 255, 255, 255] : [0, 255, 0, 255]);
        const reference = spawnSync("magick", ["-", ...options, "-deskew", "40%", "-depth", "8", "rgba:-"], { input });
        if (!reference.error) {
            expect(reference.status, reference.stderr.toString()).toBe(0);
            expect(reference.stdout.length).toBe(output.data.length);
            expect(Math.max(...output.data.map((value, index) => Math.abs(value - reference.stdout[index]!)))).toBeLessThanOrEqual(2);
        }
    }
});
