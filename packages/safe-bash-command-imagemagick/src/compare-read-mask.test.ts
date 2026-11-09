import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

function pgm(values: number[], width = values.length, depth = 255): Uint8Array {
    const header = new TextEncoder().encode(`P5\n${width} ${values.length / width}\n${depth}\n`);
    const pixels = Uint8Array.from(values.flatMap(value => depth === 255 ? [value] : [value >> 8, value & 255]));
    return Uint8Array.from([...header, ...pixels]);
}

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const scenario of ["excluded", "selected", "removed", "replaced"] as const) {
        it(`compares masked pixels and writes the difference image (${mode}, ${scenario})`, async () => {
            const files = new Map([
                ["/a.pgm", pgm([10, 20, 30, 40, 50, 60, 70, 80], 4)],
                ["/b.pgm", pgm([10, 20, 30, 200, 50, 60, 70, 80], 4)],
                ["/mask.pgm", pgm([255, 255, 255, 0, 255, 255, 255, 255], 4)],
                ["/inverse.pgm", pgm([0, 0, 0, 255, 0, 0, 0, 0], 4)]
            ]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = ["-metric", "RMSE", "/a.pgm", "-read-mask", scenario === "selected" ? "/inverse.pgm" : "/mask.pgm", "/b.pgm",
                ...(scenario === "removed" ? ["+read-mask"] : scenario === "replaced" ? ["-read-mask", "/inverse.pgm"] : []), "/diff.ppm"];
            let result;
            if (mode === "command") {
                const argumentValues = createCommandArguments(["compare", ...args]);
                let stdout = "", stderr = "";
                const status = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
                result = { ...status, stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(args, files) : await runCompareCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: scenario === "excluded" ? 0 : 1, stdout: "", stderr: scenario === "excluded" ? "0 (0)" : scenario === "removed" ? "14538.1 (0.221837)" : "41120 (0.627451)" });
            const diff = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/diff.ppm") : files.get("/diff.ppm")!);
            expect([diff.width, diff.height]).toEqual([4, 2]);
            // Native ImageMagick 7.1.2-35 Q16-HDRI: excluded pixels use #888888cc.
            const levels = scenario === "excluded" ? [206, 208, 210, 117, 214, 216, 218, 220]
                : scenario === "removed" ? [206, 208, 210, 32, 214, 216, 218, 220] : [111, 113, 115, 32, 119, 121, 123, 125];
            // PPM grayscale output retains the blue channel of the red highlight.
            expect([...diff.data]).toEqual(levels.flatMap(value => [value, value, value, 255]));
        });
    }
}

for (const retained of [false, true]) {
    for (const [mask, expected] of [
        [[127, 128], "49344 (0.752941)"], [[128, 127], "8224 (0.12549)"],
        [[127, 127], "0 (0)"], [[128, 128], "35372.8 (0.539754)"]
    ] as const) {
        it(`thresholds masks instead of weighting distortion (${mask}, retained=${retained})`, async () => {
            const files = new Map([["a.pgm", pgm([0, 0])], ["b.pgm", pgm([32, 192])], ["mask.pgm", pgm([...mask])]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
            const result = await runCompareCli(["-read-mask", "mask.pgm", "a.pgm", "b.pgm", "null:"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: expected === "0 (0)" ? 0 : 1, stdout: "", stderr: expected });
        });
    }
    it(`preserves 16-bit mask thresholds across chunks (retained=${retained})`, async () => {
        const width = 2051;
        const files = new Map([["a.pgm", pgm(Array(width).fill(0))], ["b.pgm", pgm(Array.from({ length: width }, (_, i) => i < 2048 ? 32 : 192))],
            ["mask.pgm", pgm(Array.from({ length: width }, (_, i) => i < 2048 ? 32767 : 32768), width, 65535)]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const result = await runCompareCli(["a.pgm", "-read-mask", "mask.pgm", "b.pgm", "null:"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: 1, stdout: "", stderr: "49344 (0.752941)" });
    });
}

for (const retained of [false, true]) {
    it(`uses native masked metric denominators (retained=${retained})`, async () => {
        const files = new Map([["a.pgm", pgm([0, 0])], ["b.pgm", pgm([32, 192])], ["mask.pgm", pgm([127, 128])]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const metrics = {
            AE: "0.752941 (0.376471)", MAE: "49344 (0.752941)", MEPP: "49344 (0.752941, 0.752941)",
            MSE: "37153.1 (0.56692)", RMSE: "49344 (0.752941)", Fuzz: "37153.1 (0.56692)",
            PAE: "49344 (0.752941)", PSNR: "2.46478 (0.0205398)", SSIM: "32767.5 (0.5)",
            DSSIM: "32767.5 (0.5)", NCC: "32767.5 (0.5)", DPC: "32767.5 (0.5)", PHASE: "32767.5 (0.5)", PDC: "1 (0.5)"
        };
        for (const [metric, stderr] of Object.entries(metrics)) {
            const result = await runCompareCli(["-metric", metric, "a.pgm", "-read-mask", "mask.pgm", "b.pgm", "null:"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect({ ...result, stderr: result.stderr.trim() }, metric).toEqual({ exitCode: 1, stdout: "", stderr });
        }
    });
    it(`does not replace output when the mask cannot be read (retained=${retained})`, async () => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["a.pgm", pgm([0, 0])], ["b.pgm", pgm([32, 192])], ["out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        for (const args of [["a.pgm", "b.pgm", "out.png", "-read-mask"], ["a.pgm", "-read-mask", "missing.pgm", "b.pgm", "out.png"]]) {
            expect((await runCompareCli(args, input)).exitCode).toBe(2);
            expect(retained ? await fs.readFile("/out.png") : files.get("out.png")).toEqual(original);
        }
    });
}

for (const retained of [false, true]) {
    it(`translates masks with subimage search coordinates (retained=${retained})`, async () => {
        const files = new Map([["a.pgm", pgm([0, 50, 100, 200])], ["b.pgm", pgm([100, 200])], ["mask.pgm", pgm([255, 0, 255, 255])]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const result = await runCompareCli(["-metric", "RMSE", "-subimage-search", "a.pgm", "-read-mask", "mask.pgm", "b.pgm", "null:"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0) @ 1,0 [0]" });
    });
}
