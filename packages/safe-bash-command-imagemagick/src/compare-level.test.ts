import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const pgm = (samples: number[]) => new Uint8Array([...new TextEncoder().encode("P5\n3 2\n255\n"), ...samples]);
const color = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...[51, 204, 20, 230, 51, 204].flatMap(red => [red, 100, 160])]);
const redLevels = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...[0, 255, 0, 255, 0, 255].flatMap(red => [red, 100, 160])]);
const body = pgm([20, 100, 210, 60, 160, 230]);
const levels = pgm([0, 82, 255, 15, 182, 255]);
const deep = new Uint8Array([...new TextEncoder().encode("P5\n3 2\n65535\n"),
    ...[1, 4660, 32768, 65534, 65535, 0].flatMap(value => [value >> 8, value & 255])]);

// Native ImageMagick 7.1.2-35 Q16-HDRI retains fractional leveled samples.
for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    for (const [inputs, stderr, pixels] of [
        [["-channel", "R", "(", "color.ppm", "-level", "20%,80%", ")", "+channel", "red-levels.ppm"], "0 (0)", undefined],
        [["body.pgm", "levels.pgm"], "8047.42 (0.122796)", undefined],
        [["(", "body.pgm", "-level", "20%,80%", ")", "levels.pgm"], "49.4599 (0.000754709)", [204, 40, 255, 207, 60, 255]],
        [["(", "body.pgm", "-level", "0%,100%", ")", "body.pgm"], "0 (0)", [208, 224, 246, 216, 236, 250]],
        [["levels.pgm", "(", "body.pgm", "-level", "20%,80%", ")"], "49.4599 (0.000754709)", undefined],
        [["body.pgm", "-level", "20%,80%", "levels.pgm"], "82.4334 (0.00125785)", undefined],
        [["-level", "20%,80%", "body.pgm", "levels.pgm"], "5213.83 (0.079558)", undefined],
        [["body.pgm", "levels.pgm", "-level", "20%,80%"], "5213.83 (0.079558)", undefined],
        [["(", "body.pgm", "-level", "20%,80%,2", ")", "body.pgm"], "9423.7 (0.143796)", undefined],
        [["(", "body.pgm", "+level", "20%,80%", ")", "body.pgm"], "7878.07 (0.120212)", undefined],
        [["(", "body.pgm", "-level", "13107,52428", ")", "body.pgm"], "8045.75 (0.12277)", undefined],
        [["(", "deep.pgm", "-level", "0%,100%", ")", "deep.pgm"], "0 (0)", undefined],
        [["(", "deep.pgm", "-level", "10,65525", ")", "deep.pgm"], "3.55026 (5.41735e-05)", undefined]
    ] as const) {
        it(`matches native compare ${inputs.join(" ")} (${mode})`, async () => {
            const marker = new TextEncoder().encode("KEEP");
            const files = new Map([["body.pgm", body.slice()], ["levels.pgm", levels.slice()], ["deep.pgm", deep.slice()], ["color.ppm", color.slice()], ["red-levels.ppm", redLevels.slice()], ["diff.pgm", marker], ["snapshot.pgm", marker]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", "RMSE", ...inputs, "diff.pgm"];
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
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: stderr === "0 (0)" ? 0 : 1, stdout: "", stderr });
            const read = async (name: string) => mode === "sync" || mode === "memory" ? files.get(name)! : filesystem.readFile(`/${name}`);
            const diff = decodeImage(await read("diff.pgm"));
            expect([diff.width, diff.height]).toEqual([3, 2]);
            if (pixels) expect([...diff.data]).toEqual(pixels.flatMap(gray => [gray, gray, gray, 255]));
            expect(await read("body.pgm")).toEqual(body);
            expect(await read("levels.pgm")).toEqual(levels);
            expect(await read("snapshot.pgm")).toEqual(marker);
        });
    }
}

for (const retained of [false, true]) {
    it(`rejects invalid and missing levels without replacing output (retained=${retained})`, async () => {
        const marker = new TextEncoder().encode("KEEP");
        const files = new Map([["body.pgm", body.slice()], ["diff.pgm", marker]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        for (const option of ["-level", "+level"]) {
            for (const geometry of ["bogus", "20%,80%junk"]) {
                const result = await runCompareCli(["body.pgm", option, geometry, "body.pgm", "diff.pgm"], retained ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(2);
                expect(result.stderr).toContain(`invalid argument for option '${option}'`);
            }
            const result = await runCompareCli(["body.pgm", "body.pgm", "diff.pgm", option], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(2);
            expect(result.stderr).toContain(`missing an argument for option '${option}'`);
        }
        expect(retained ? await filesystem.readFile("/diff.pgm") : files.get("diff.pgm")).toEqual(marker);
    });
}
