import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const native = spawnSync("magick", ["-list", "compose"], { encoding: "utf8" });

it("rejects unknown compare compose operators before writing output", async () => {
    const images = await Promise.all(["red", "blue"].map(background =>
        sharp({ create: { width: 1, height: 1, channels: 4, background } }).png().toBuffer()));
    const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    for (const operator of ["bogus", "", "OverBogus"]) {
        const args = ["-compose", operator, "a.png", "b.png", "diff.png"];
        const expected = { exitCode: 2, stdout: "", stderr: `compare: unrecognized compose operator '${operator}'\n` };
        expect(runCompareCliSync(args, files)).toEqual(expected);
        for (const input of [files, { filesystem, cwd: "/" }])
            expect(await runCompareCli(args, input)).toEqual(expected);
        expect(files.has("diff.png")).toBe(false);
        await expect(filesystem.readFile("/diff.png")).rejects.toMatchObject({ code: "ENOENT" });
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", "-compose", operator,
                ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"]);
            expect(reference.status).toBe(2);
            expect(reference.stderr.toString()).toContain("unrecognized compose operator");
        }
    }
});

it("keeps recognized compare compose operators and existing aliases", async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    const files = new Map([["a.png", image]]);
    const operators = ["Over", "Src", "Source", "Copy", "CopyOpacity", "Add", "Subtract", "Minus", "Divide", "Undefined", "Src-Over", "Src_Over",
        ...(!native.error ? native.stdout.trim().split("\n") : [])];
    for (const operator of operators) {
        const result = await runCompareCli(["-compose", operator, "a.png", "a.png", "null:"], files);
        expect(result, operator).toMatchObject({ exitCode: 0, stderr: "0 (0)" });
    }
});

// Native ImageMagick 7.1.2 Q16-HDRI, with one equal and one changed pixel.
for (const retained of [false, true]) {
    for (const [mode, expected] of [
        ["Over", "cfd2d6ffda1d38ff"],
        ["Src", "ffffffccf1001ecc"],
        ["Clear", "0000000000000000"],
        ["Multiply", "102030ff7a1d2fff"],
        ["Dst", "ffffffffffffffff"],
        ["Difference", "3d465033756f4733"],
        ["Xor", "0000003300000033"],
        ["Screen", "ffffffffffffffff"],
        ["SrcIn", "ccccccccc10018cc"],
        ["DstOut", "0000003300000033"]
    ]) {
        it(`composes compare output with ${mode}, retained=${retained}`, async () => {
            const files = new Map<string, Uint8Array>();
            for (const [name, pixels] of [["a.png", "102030ff8090a0ff"], ["b.png", "102030ff8090f0ff"]]) {
                files.set(name!, await sharp(Buffer.from(pixels!, "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer());
            }
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const input = retained ? { filesystem, cwd: "/" } : files;
            const baseline = await runCompareCli(["a.png", "b.png", "null:"], input);
            expect(baseline).toEqual({ exitCode: 1, stdout: "", stderr: "7269.06 (0.110919)" });
            const result = await runCompareCli(["-compose", "Src", "-compose", mode!, "a.png", "b.png", "out.png"], input);
            expect(result).toEqual(baseline);
            const output = retained ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            const pixels = decodeImage(output).data;
            expect(Buffer.from(pixels).toString("hex")).toBe(expected);
        });
    }
}
