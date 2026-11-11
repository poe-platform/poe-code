import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n");

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    const run = async (args: string[]) => {
        const marker = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input.slice()], ["diff.ppm", marker]]);
        if (args.includes("ink.miff")) expect(runConvertCliSync(["a.ppm", "-colorspace", "CMYK", "ink.miff"], files).exitCode).toBe(0);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
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
            : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        const read = async (name: string) => mode === "sync" || mode === "buffered" ? files.get(name)! : filesystem.readFile(`/${name}`);
        expect(await read("a.ppm")).toEqual(input);
        expect(await read("diff.ppm")).toEqual(marker);
        return result;
    };

    // Native ImageMagick 7.1.2-35 Q16-HDRI; metrics retain fractional samples.
    for (const [option, metric] of [["-sigmoidal-contrast", "2588.04 (0.039491)"], ["+sigmoidal-contrast", "2575.16 (0.0392944)"]] as const) {
        for (const inputs of [
            ["(", "a.ppm", option, "4x50%", ")", "a.ppm"],
            ["a.ppm", "(", "a.ppm", option, "4x50%", ")"]
        ]) it(`${mode} applies ${inputs.join(" ")} before comparison`, async () => {
            expect(await run(["-metric", "RMSE", ...inputs, "null:"]))
                .toEqual({ exitCode: 1, stdout: "", stderr: metric });
        });

        for (const inputs of [
            [option, "4x50%", "a.ppm", "a.ppm"],
            ["a.ppm", "a.ppm", option, "4x50%"]
        ]) it(`${mode} applies ${inputs.join(" ")} to both operands`, async () => {
            expect(await run(["-metric", "RMSE", ...inputs, "null:"]))
                .toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
        });

        for (const channel of ["R", "K"]) it(`${mode} applies ${option} only to selected ${channel} samples`, async () => {
            const image = channel === "K" ? "ink.miff" : "a.ppm";
            const inputs = ["(", image, "-channel", channel, option, "4x50%", ")", image];
            const changed = await run(["-metric", "RMSE", ...inputs, "null:"]);
            expect(changed.exitCode).toBe(1);
            expect(changed.stderr).not.toBe("0 (0)");
            expect(await run(["-metric", "RMSE", ...inputs, "-channel", "G", "null:"]))
                .toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
        });

        it(`${mode} rejects invalid or missing ${option} geometry without replacing output`, async () => {
            for (const geometry of ["bogus", "4x50%junk"]) {
                const result = await run(["a.ppm", option, geometry, "a.ppm", "diff.ppm"]);
                expect(result.exitCode).toBe(2);
                expect(result.stderr).toContain(`invalid argument for option '${option}'`);
            }
            expect(await run(["a.ppm", "a.ppm", "diff.ppm", option]))
                .toEqual({ exitCode: 2, stdout: "", stderr: `compare: missing an argument for option '${option}'\n` });
        });
    }

    it(`${mode} leaves the unchanged-image control equal`, async () => {
        expect(await run(["-metric", "RMSE", "a.ppm", "a.ppm", "null:"]))
            .toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    });
}
