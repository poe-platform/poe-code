import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";


for (const mode of ["buffered", "retained", "sync"] as const)
for (const option of ["-raise", "+raise"])
it.each(["6x1", "7x2", "1x5", "1x6", "5"])(`rejects oversized ${option} %s without output, ${mode}`, async geometry => {
    const input = await sharp({ create: { width: 12, height: 10, channels: 3, background: { r: 64, g: 96, b: 128 } } }).png().toBuffer();
    const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["input.png", option, geometry, "out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("size must exceed bevel width");
    expect(files.has("out.png")).toBe(false);
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["input.png"]);
});

for (const mode of ["buffered", "retained", "sync"] as const)
for (const option of ["-raise", "+raise"])
it.skipIf(spawnSync("magick", ["-version"]).status !== 0).each([8, 16])(`matches native largest valid bevel for ${option}, ${mode}, depth %s`, async depth => {
    const input = spawnSync("magick", ["-size", "12x10", "xc:#406080", "-depth", String(depth), depth === 16 ? "PNG48:-" : "PNG24:-"]);
    expect(input.status).toBe(0);
    const files = new Map([["input.png", new Uint8Array(input.stdout)]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input.stdout);
    const args = ["input.png", option, "5x4", "out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    const reference = spawnSync("magick", ["png:-", option, "5x4", "-depth", String(depth), "rgba:-"], { input: input.stdout });
    const actual = spawnSync("magick", ["png:-", "-depth", String(depth), "rgba:-"], { input: output });
    expect(reference.status).toBe(0);
    expect(actual.status).toBe(0);
    expect(actual.stdout.equals(reference.stdout)).toBe(true);
});
