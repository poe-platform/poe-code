import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// 6x4 RGB grid from native ImageMagick 7.1.2-35 Q16-HDRI comparisons.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAH0lEQVR4nGOUdsmtRgWMf9X80YXucxiiCx18JYwmBADurCHtclsDfQAAAABJRU5ErkJggg==", "base64");
const source = decodeImage(input);

for (const mode of ["public", "sync"] as const) {
    async function run(options: string[]) {
        const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await fs.writeFile("/input.png", input);
        const args = ["/input.png", "-filter", "point", ...options, "/out.png"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            signal: new AbortController().signal, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        return { image: decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!), stderr };
    }

    function expectViewport(image: ReturnType<typeof decodeImage>, width: number, height: number, x: number, y: number) {
        expect([image.width, image.height]).toEqual([width, height]);
        expect(image.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual({ width, height, x, y });
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
            const sx = Math.max(0, Math.min(5, Math.floor(i / 4) % width + x));
            const sy = Math.max(0, Math.min(3, Math.floor(i / 4 / width) + y));
            return source.data[(sy * 6 + sx) * 4 + i % 4]!;
        });
        expect(image.data).toEqual(pixels);
    }

    for (const operator of ["-distort", "+distort"]) {
        const bestFit = operator === "+distort", w = bestFit ? 8 : 6, h = bestFit ? 6 : 4, origin = bestFit ? -1 : 0;
        it.each(["option", "artifact"])(`reads %s viewport pixels with ${operator} (${mode})`, async namespace => {
            const { image, stderr } = await run(["-set", `${namespace}:distort:viewport`, "3x2+1+1", operator, "PerspectiveProjection", "1,0,0,0,1,0,0,0", "-set", `${namespace}:distort:viewport`, "1x1+0+0"]);
            expect(stderr).toBe("");
            expectViewport(image, 3, 2, 1, 1);
        });

        it.each([
            { viewport: "3x2+1+1", width: 3, height: 2, x: 1, y: 1 },
            { viewport: "+1+1", width: w, height: h, x: 1, y: 1 },
            { viewport: "3x2", width: 3, height: 2, x: origin, y: origin },
            { viewport: "3", width: 3, height: h, x: origin, y: origin },
            { viewport: "3x2+2", width: 3, height: 2, x: 2, y: origin },
            { viewport: "3x2-1-1", width: 3, height: 2, x: -1, y: -1 },
            { viewport: "3.6x2.6+1.5-1.5", width: 4, height: 3, x: 1, y: -1 },
            { viewport: "x2", width: 6, height: 4, x: origin, y: origin },
            { viewport: "0x2", width: 6, height: 4, x: origin, y: origin }
        ])(`honors $viewport with ${operator} (${mode})`, async ({ viewport, width, height, x, y }) => {
            const { image, stderr } = await run(["-define", `distort:viewport=${viewport}`, operator, "PerspectiveProjection", "1,0,0,0,1,0,0,0"]);
            expect(stderr).toBe("");
            expectViewport(image, width, height, x, y);
        });

        it.each([undefined, "nonsense", ""])(`keeps default geometry for %s with ${operator} (${mode})`, async viewport => {
            const { image, stderr } = await run([...(viewport === undefined ? [] : ["-define", `distort:viewport=${viewport}`]), operator, "PerspectiveProjection", "1,0,0,0,1,0,0,0"]);
            expectViewport(image, w, h, origin, origin);
            if (viewport === undefined) expect(stderr).toBe("");
            else expect(stderr).toContain(`invalid setting 'distort:viewport' '${viewport}'`);
        });

        it(`resets the viewport with +define (${operator}, ${mode})`, async () => {
            const { image, stderr } = await run(["-define", "distort:viewport=3x2+1+1", "+define", "distort:viewport", operator, "PerspectiveProjection", "1,0,0,0,1,0,0,0"]);
            expect(stderr).toBe("");
            expectViewport(image, w, h, origin, origin);
        });
    }

    it(`captures each operation's viewport before later defines (${mode})`, async () => {
        const { image, stderr } = await run(["-define", "distort:viewport=3x2+1+1", "-distort", "PerspectiveProjection", "1,0,0,0,1,0,0,0", "-define", "distort:viewport=1x1+0+0"]);
        expect(stderr).toBe("");
        expectViewport(image, 3, 2, 1, 1);
    });

    it(`suppresses invalid viewport warnings with -quiet (${mode})`, async () => {
        const { image, stderr } = await run(["-quiet", "-define", "distort:viewport=nonsense", "-distort", "PerspectiveProjection", "1,0,0,0,1,0,0,0"]);
        expect(stderr).toBe("");
        expectViewport(image, 6, 4, 0, 0);
    });

    it.each([
        ["SRT", "0"], ["Perspective", "0,0,0,0 6,0,6,0 0,4,0,4 6,4,6,4"],
        ["Affine", "0,0,0,0 6,0,6,0 0,4,0,4"], ["Barrel", "0,0,0,1"], ["BarrelInverse", "0,0,0,1"]
    ])(`applies the viewport to %s (${mode})`, async (method, coefficients) => {
        const filtered = ["SRT", "Barrel", "BarrelInverse"].includes(method);
        const { image, stderr } = await run([...(filtered ? ["-filter", "Robidoux"] : []), "-define", "distort:viewport=3x2+1+1", "+distort", method, coefficients]);
        expect(stderr).toBe("");
        if (!filtered) expectViewport(image, 3, 2, 1, 1);
        else {
            expect([image.width, image.height, image.virtualCanvas]).toEqual([3, 2, { width: 3, height: 2, x: 1, y: 1 }]);
            // Native default radial filter; coordinates shift before filtering.
            expect([...image.data]).toEqual([136, 153, 202, 255, 227, 44, 69, 255, 126, 135, 192, 255, 90, 131, 172, 255, 213, 238, 39, 255, 80, 137, 154, 255]);
        }
    });
}
