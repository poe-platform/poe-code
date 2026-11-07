import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

for (const entry of ["sync", "async", "filesystem", "magick"] as const) {
    it(`preserves comparisons with diagnostic options through ${entry}`, async () => {
        const a = await sharp(Buffer.from("102030ff8090a0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const b = await sharp(Buffer.from("102030ff8090f0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        for (const identical of [false, true]) {
            let expectedPixels: number[] | undefined;
            let expectedStderr = "";
            for (const options of [[], ["-quiet"], ["-regard-warnings"], ["-verbose"], ["-quiet", "-verbose"], ["-verbose", "+verbose"], ["+quiet", "+regard-warnings"]]) {
                const files = new Map([["a.png", a], ["b.png", identical ? a : b]]);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const args = [...options, "a.png", "b.png", "o.png"];
                const result = entry === "sync" ? runCompareCliSync(args, files)
                    : entry === "magick" ? await runMagickCli(["compare", ...args], files)
                    : await runCompareCli(args, entry === "filesystem" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(identical ? 0 : 1);
                expect(result.stdout).toBe("");
                if (options.length === 0) expectedStderr = result.stderr;
                if (options.includes("-verbose") && !options.includes("+verbose")) {
                    expect(result.stderr).toContain("a.png PNG 2x1");
                    expect(result.stderr).toContain("b.png PNG 2x1");
                    expect(result.stderr).toContain("Image: a.png\n  Channel distortion: Undefined\n");
                    expect(result.stderr).toContain("a.png=>o.png PNG 2x1");
                } else expect(result.stderr).toBe(expectedStderr);
                const bytes = entry === "filesystem" ? await filesystem.readFile("/o.png") : files.get("o.png")!;
                const pixels = [...await sharp(bytes).ensureAlpha().raw().toBuffer()];
                if (!expectedPixels) expectedPixels = pixels;
                expect(pixels).toEqual(expectedPixels);
            }
        }
    });
}

it("suppresses color warnings independently of warning exit status", async () => {
    const a = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    for (const options of [["-quiet"], ["-regard-warnings"], ["-quiet", "-regard-warnings"], ["-regard-warnings", "+regard-warnings"]]) {
        const files = new Map([["a.png", a]]);
        const result = await runCompareCli([...options, "-highlight-color", "nope", "a.png", "a.png", "o.png"], files);
        expect(result.exitCode).toBe(options.includes("-regard-warnings") && !options.includes("+regard-warnings") ? 2 : 0);
        expect(result.stderr.includes("unrecognized color")).toBe(!options.includes("-quiet"));
        expect(result.stderr).toContain("0 (0)");
        expect(files.has("o.png")).toBe(true);
    }
});

it("includes the selected metric and aggregate distortion in verbose details", async () => {
    const result = await runCompareCli(["-verbose", "-metric", "RMSE", "xc:red", "xc:blue", "null:"], new Map());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Channel distortion: RMSE\n    all: 53509.1 (0.816497)\n");
});
