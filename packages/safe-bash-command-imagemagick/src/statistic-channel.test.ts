import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const pixels = [32, 96, 160, 64, 192, 64, 16, 192, 80, 112, 176, 128];
const filters = ["Median", "Mean", "Minimum", "Maximum", "Mode", "RootMeanSquare", "StandardDeviation", "Contrast", "Nonpeak"];

it.each([false, true])("preserves unselected statistic channels (retained=%s)", async retained => {
    const input = await sharp(new Uint8Array(pixels), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    async function run(filter: string, channel?: string) {
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...(channel ? ["-channel", channel] : []), "-statistic", filter, "3x1", "+channel", "out.png"];
        expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        return [...decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data];
    }
    for (const filter of filters) {
        const all = await run(filter, "RGBA");
        for (const [channel, selected] of [["R", [0]], ["B", [2]], ["A", [3]], ["RG", [0, 1]]] as const) {
            const actual = await run(filter, channel);
            expect(actual, `${filter} ${channel}`).toEqual(pixels.map((value, index) => selected.some(c => c === index % 4) ? all[index] : value));
            // Native ImageMagick center samples from the reported RGB fixture.
            if (filter === "Median" && channel === "R") expect(actual.slice(4, 7)).toEqual([80, 64, 16]);
            if (filter === "Mean" && channel === "B") expect(actual.slice(4, 7)).toEqual([192, 64, 117]);
        }
    }
});
