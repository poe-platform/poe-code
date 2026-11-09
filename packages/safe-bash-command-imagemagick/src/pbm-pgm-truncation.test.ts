import {expect, it} from "vitest";
import {createCommandArguments} from "safe-bash-contracts/command";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {decodeImage} from "@poe-code/image-ast";
import {createMagickCommand} from "./index.js";

const fixtures = [
    {name: "P5 maxval 65535", header: "P5\n1 1\n65535\n", raster: Buffer.from([128, 0]), gray: [128]},
    {name: "P5 maxval 65536", header: "P5\n1 1\n65536\n", raster: Buffer.from([0, 0, 128, 0]), gray: [128]},
    {name: "P5 four-byte over-range", header: "P5\n1 1\n65536\n", raster: Buffer.from([255, 255, 255, 255]), gray: [255]},
    {name: "P5 unsigned four-byte", header: "P5\n1 1\n4294967295\n", raster: Buffer.from([255, 255, 255, 255]), gray: [255]},
    {name: "P1", header: "P1\n4 1\n", raster: Buffer.from("0 1 0 1"), gray: [255, 0, 255, 0]},
    {name: "P4 nine-bit row", header: "P4\n9 1\n", raster: Buffer.from([0x80, 0x80]), gray: [0, 255, 255, 255, 255, 255, 255, 255, 0]},
    {name: "P4 row padding", header: "P4\n1 2\n", raster: Buffer.from([0x80, 0]), gray: [0, 255]},
    {name: "P5", header: "P5\n3 1\n255\n", raster: Buffer.from([0, 128, 255]), gray: [0, 128, 255]},
    {name: "P5 sixteen-bit", header: "P5\n3 1\n65535\n", raster: Buffer.from([0, 0, 128, 128, 255, 255]), gray: [0, 128, 255]}
];

for (const fixture of fixtures) {
    for (const length of new Set([0, Math.floor(fixture.raster.length / 2), fixture.raster.length - 1, fixture.raster.length])) {
        it(`${fixture.name} with ${length} bytes preserves or replaces the actual destination`, async () => {
            const bytes = Buffer.concat([Buffer.from(fixture.header), fixture.raster.subarray(0, length)]);
            const complete = length === fixture.raster.length;
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pnm", bytes);
            await fs.writeFile("/out.miff", Buffer.from("keep"));
            const args = createCommandArguments(["in.pnm", "out.miff"]);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: {async write() {}}, stderr: {async write() {}}
            });
            expect(result.exitCode).toBe(complete ? 0 : 1);
            if (!complete) expect(() => decodeImage(bytes)).toThrow("Truncated");
            const output = await fs.readFile("/out.miff");
            if (complete) expect(Array.from(decodeImage(output).data)).toEqual(fixture.gray.flatMap(g => [g, g, g, 255]));
            else expect(new TextDecoder().decode(output)).toBe("keep");
        });
    }
}

it("continues to fill a missing final plain P2 sample", () => {
    expect(Array.from(decodeImage(Buffer.from("P2\n3 1\n255\n0 128\n")).data)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 0, 0, 0, 255]);
});
