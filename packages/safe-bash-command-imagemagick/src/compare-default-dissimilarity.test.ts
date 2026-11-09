import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 distinguishes UndefinedErrorMetric from explicit RMSE
// when checking dissimilarity, despite printing the same distortion and offset.
for (const threshold of [undefined, "0", "1"] as const) {
    for (const output of ["null:", "diff.png"]) {
        it(`preserves the default metric warning with threshold ${threshold ?? "default"} and output ${output}`, async () => {
            const a = await sharp(Buffer.from("102030ff8090a0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const p = await sharp(Buffer.from("8090a0ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            const args = ["-subimage-search", ...(threshold === undefined ? [] : ["-dissimilarity-threshold", threshold]), "a.png", "p.png", output];
            for (const entry of ["sync", "async", "filesystem"]) {
                const files = new Map([["a.png", a.slice()], ["p.png", p.slice()]]);
                const filesystem = new MemoryFileSystem();
                for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
                const result = entry === "sync" ? runCompareCliSync(args, files)
                    : await runCompareCli(args, entry === "async" ? files : { filesystem, cwd: "/" });
                expect(result).toEqual({
                    exitCode: 0,
                    stdout: "",
                    stderr: "0 (0) @ 1,0 [0]" + (threshold === "0" ? "" : "compare: images too dissimilar 'a.png'\n")
                });
                const names = entry === "filesystem" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()];
                expect(names.some(name => name.startsWith("diff"))).toBe(output !== "null:");
            }
        });
    }
}

it("keeps explicit RMSE dissimilarity separate from the default metric", async () => {
    const a = await sharp(Buffer.from("102030ff8090a0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const p = await sharp(Buffer.from("8090a0ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    expect(await runCompareCli(["-metric", "RMSE", "-subimage-search", "-dissimilarity-threshold", "1", "a.png", "p.png", "null:"], new Map([["a.png", a], ["p.png", p]])))
        .toEqual({ exitCode: 0, stdout: "", stderr: "0 (0) @ 1,0 [0]" });
});
