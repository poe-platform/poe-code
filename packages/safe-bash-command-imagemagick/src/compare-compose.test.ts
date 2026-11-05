import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
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
        expect(result, operator).toMatchObject({ exitCode: 0, stderr: "0 (0)\n" });
    }
});
