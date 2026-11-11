import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// Pretagged MIFF matching the ImageMagick 7.1.2-35 Q16-HDRI reproduction:
// magick in.ppm -red-primary 0.68,0.32 -green-primary 0.265,0.69
//   -blue-primary 0.15,0.06 -white-point 0.314,0.351 tagged.miff
const coordinates = ["red-primary=0.68,0.32", "green-primary=0.265,0.69", "blue-primary=0.15,0.06", "white-point=0.314,0.351"];
const defaults = ["red-primary=0.64,0.33", "green-primary=0.3,0.6", "blue-primary=0.15,0.06", "white-point=0.3127,0.329"];
const pixels = Uint8Array.of(255, 0, 0, 32, 128, 64, 0, 0, 255);
function fixture(fields: readonly string[]) {
    return new Uint8Array([
        ...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0\ncolumns=3 rows=1 depth=8\ncolorspace=sRGB compression=None\n${fields.join("\n")}\n\f\n:\x1a`),
        ...pixels
    ]);
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const flop of [false, true]) {
        it(`preserves custom MIFF chromaticities through ${mode}, flop=${flop}`, async () => {
            const input = fixture(coordinates);
            const files = new Map([["in.miff", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.miff", input);
            const args = ["in.miff", ...(flop ? ["-flop"] : []), "out.miff"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
            const end = output.indexOf(26);
            const header = new TextDecoder().decode(output.subarray(0, end));
            for (const field of coordinates) expect(header).toContain(field);
            expect(output.subarray(end + 1)).toEqual(flop ? Uint8Array.of(0, 0, 255, 32, 128, 64, 255, 0, 0) : pixels);
        });
    }
}

for (const retained of [false, true]) {
    it(`retains independent chromaticities for each MIFF frame, retained=${retained}`, async () => {
        const frames = [coordinates, ["red-primary=0.7,0.3", "white-point=0.333,0.333"], []];
        const input = new Uint8Array(frames.flatMap(fields => [...fixture(fields)]));
        const files = new Map([["in.miff", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.miff", input);
        expect(await runConvertCli(["in.miff", "out.miff"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
        const output = retained ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
        let offset = 0;
        for (const fields of frames) {
            const end = output.indexOf(26, offset);
            const header = new TextDecoder().decode(output.subarray(offset, end));
            for (const field of fields) expect(header).toContain(field);
            for (const field of defaults) {
                const key = field.split("=")[0]!;
                if (!fields.some(value => value.startsWith(`${key}=`))) expect(header).toContain(field);
            }
            expect(output.subarray(end + 1, end + 1 + pixels.length)).toEqual(pixels);
            offset = end + 1 + pixels.length;
        }
        expect(offset).toBe(output.length);
    });
}
