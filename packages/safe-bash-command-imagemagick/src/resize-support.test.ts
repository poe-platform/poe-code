import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7 Q16-HDRI grayscale impulse rows.
const cases: [string, string[], number, number[]][] = [
    ["Mitchell", ["filter:blur=1.5"], 27, [32, 32, 32, 32, 32, 30, 28, 28, 33, 48, 76, 109, 135, 145, 135, 109, 76, 48, 33, 28, 28, 30, 32, 32, 32, 32, 32]],
    ["Mitchell", ["filter:blur=1.5"], 4, [36, 72, 72, 36]],
    ["Lanczos", ["filter:support=1.5"], 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 27, 32, 86, 174, 224, 174, 86, 32, 27, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Lanczos", ["filter:support=1.5"], 4, [32, 76, 76, 32]],
    ["Lanczos", ["filter:lobes=2"], 27, [32, 32, 32, 32, 32, 32, 32, 32, 26, 16, 32, 97, 181, 224, 181, 97, 32, 16, 26, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Lanczos", ["filter:lobes=2"], 4, [26, 80, 80, 26]],
    ["Lanczos", ["filter:lobes=4", "filter:support=1.5"], 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 27, 32, 86, 174, 224, 174, 86, 32, 27, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Lanczos", ["filter:lobes=4", "filter:support=1.5"], 4, [32, 76, 76, 32]],
    ["Lanczos", ["filter:blur=0.7"], 27, [32, 32, 32, 32, 32, 32, 32, 33, 40, 26, 0, 44, 210, 255, 210, 44, 0, 26, 40, 33, 32, 32, 32, 32, 32, 32, 32]],
    ["Lanczos", ["filter:blur=0.7"], 4, [35, 71, 71, 35]],
    ["Box", ["filter:blur=2"], 27, [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 128, 128, 128, 128, 128, 128, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Box", ["filter:blur=2"], 4, [32, 70, 70, 32]],
    ["Mitchell", ["filter:support=3"], 27, [32, 32, 32, 32, 32, 32, 32, 32, 28, 26, 43, 98, 168, 203, 168, 98, 43, 26, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
    ["Mitchell", ["filter:support=3"], 4, [29, 77, 77, 29]],
    ["Lanczos", ["filter:blur=0"], 27, [0, 32, 0, 0, 32, 0, 0, 32, 0, 0, 32, 0, 0, 224, 0, 0, 32, 0, 0, 32, 0, 0, 32, 0, 0, 32, 0]],
    ["Lanczos", ["filter:blur=0"], 4, [0, 0, 0, 0]],
    ["Jinc", ["filter:lobes=2"], 27, [32, 32, 32, 32, 32, 32, 32, 21, 11, 22, 60, 118, 169, 188, 169, 118, 60, 22, 11, 21, 32, 32, 32, 32, 32, 32, 32]],
    ["Jinc", ["filter:lobes=2"], 4, [22, 80, 80, 22]]
];
for (const mode of ["buffered", "retained", "sync"] as const) for (const vertical of [false, true]) {
    it.each(cases)(`${mode}, vertical=${vertical}: %s with %j to %i`, async (filter, defines, target, expected) => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-filter", filter, ...defines.flatMap(value => ["-define", value]), "-resize", vertical ? `1x${target}!` : `${target}x1!`, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["blur=1.5", "support=1.5", "lobes=2"])(`${mode}: snapshots and clears filter:%s`, async (define) => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-filter", "Lanczos", "-define", `filter:${define}`, "-resize", "27x1!", "-write", "/changed.png", "+delete", "/in.png", "+define", `filter:${define.split("=")[0]}`, "-resize", "27x1!", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const changed = decodeImage(mode === "retained" ? await filesystem.readFile("/changed.png") : files.get("/changed.png")!);
        expect([...output.data.slice(9 * 4, 14 * 4)]).toEqual([4, 32, 105, 188, 224].flatMap(value => [value, value, value, 255]));
        expect([...changed.data]).not.toEqual([...output.data]);
    });
}
