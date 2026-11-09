import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const pgm = (negative: boolean) => new Uint8Array([
    ...new TextEncoder().encode("P5\n4 2\n255\n"),
    ...Array.from({ length: 8 }, (_, i) => negative ? 245 - i * 10 : 10 + i * 10)
]);

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    for (const [inputs, equal, firstPixel] of [
        [["a.pgm", "negative.pgm"], false, undefined],
        [["a.pgm", "-negate", "negative.pgm"], true, 206],
        [["a.pgm", "-negate", "a.pgm"], false, undefined],
        [["a.pgm", "-negate", "negative.pgm", "-negate"], true, 253],
        [["a.pgm", "-negate", "-negate", "negative.pgm"], false, undefined],
        [["-negate", "a.pgm", "negative.pgm"], false, undefined],
        [["a.pgm", "negative.pgm", "-negate"], false, undefined],
        [["a.pgm", "+negate", "negative.pgm"], true, 206]
    ] as const) {
        it(`matches native compare ${inputs.join(" ")} (${mode})`, async () => {
            const files = new Map([["a.pgm", pgm(false)], ["negative.pgm", pgm(true)]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", "RMSE", ...inputs, "diff.ppm"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
                const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
                let stdout = "", stderr = "";
                result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () { })(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(args, files)
                : await runCompareCli(args, mode === "memory" ? files : { filesystem, cwd: "/" });
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: equal ? 0 : 1, stdout: "", stderr: equal ? "0 (0)" : "44010.1 (0.671551)" });
            const diff = decodeImage(mode === "memory" || mode === "sync" ? files.get("diff.ppm")! : await filesystem.readFile("/diff.ppm"));
            expect([diff.width, diff.height]).toEqual([4, 2]);
            // Native ImageMagick 7.1.2-35 Q16-HDRI replays image operators at finalization.
            if (firstPixel !== undefined) expect([...diff.data]).toEqual(Array.from({ length: 8 }, (_, i) => {
                const gray = firstPixel === 206 ? 206 + 2 * i : 253 - 2 * i;
                return [gray, gray, gray, 255];
            }).flat());
            expect(await filesystem.readFile("/a.pgm")).toEqual(pgm(false));
        });
    }
}

for (const retained of [false, true]) {
    it(`preserves low 16-bit differences and positional channel selection (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>();
        for (const [name, red] of [["a.png", 0x1234], ["negative.png", 65535 - 0x1234], ["near.png", 65535 - 0x1235]] as const) {
            const data16 = Uint16Array.of(red, 0x2345, 0x3456, 65535);
            files.set(name, encodeImage({ width: 1, height: 1, format: "png", density: 72, channels: 3,
                hasAlpha: false, space: "srgb", depth: "ushort", data16,
                data: Uint8Array.from(data16, sample => Math.round(sample / 257)) }, { format: "png" }).data);
        }
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        for (const [candidate, stderr, exitCode] of [["negative.png", "0 (0)", 0], ["near.png", "0.57735 (8.8098e-06)", 1]] as const) {
            const args = ["a.png", "-channel", "R", "-negate", "+channel", candidate, "null:"];
            const result = await runCompareCli(args, retained ? { filesystem, cwd: "/" } : files);
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ stdout: "", stderr, exitCode });
        }
    });
}

for (const retained of [false, true]) {
    it(`limits +negate to gray pixels while preserving alpha semantics (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>();
        for (const [name, samples] of [["a.png", [100, 150, 200, 160, 100, 100, 100, 160]],
            ["b.png", [100, 150, 200, 160, 155, 155, 155, 95]]] as const) {
            files.set(name, encodeImage({ width: 2, height: 1, format: "png", density: 72, channels: 4,
                hasAlpha: true, space: "srgb", depth: "uchar", data: Uint8Array.from(samples) }, { format: "png" }).data);
        }
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const result = await runCompareCli(["a.png", "+negate", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    });
}
