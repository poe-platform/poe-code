import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick: -size 2x2 xc:red -size 2x2 xc:blue (or green) -loop 0 gif:-
const animations = new Map([
    ["a.gif", Buffer.from("R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgACAAACAoRRACH5BAAAAAAALAAAAAACAAIAgAAA/wAAAAIChFEAOw==", "base64")],
    ["b.gif", Buffer.from("R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgACAAACAoRRACH5BAAAAAAALAAAAAACAAIAgACAAAAAAAIChFEAOw==", "base64")]
]);
const native = spawnSync("magick", ["-version"]);
const cases = [
    ["a.gif", "a.gif", "2.66667 (0.666667)", "53509.1 (0.816497)"],
    ["a.gif", "b.gif", "2.66667 (0.666667)", "53509.1 (0.816497)"],
    ["b.gif", "a.gif", "2.00261 (0.500654)", "42335.9 (0.646004)"],
    ["a.gif[0]", "a.gif[0]", "0 (0)", "0 (0)"],
    ["a.gif[0]", "a.gif[1]", "2.66667 (0.666667)", "53509.1 (0.816497)"],
    ["a.gif[0]", "b.gif", "0 (0)", "0 (0)"],
    ["a.gif[1,0]", "a.gif[1]", "2.66667 (0.666667)", "53509.1 (0.816497)"]
];

for (const [first, second, ae, rmse] of cases) {
    for (const [metric, value] of [["AE", ae!], ["RMSE", rmse!]]) {
        it(`compares the first two selected frames: ${metric} ${first} ${second}`, async () => {
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of animations) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", metric!, first!, second!, "null:"];
            const expected = { exitCode: value === "0 (0)" ? 0 : 1, stdout: "", stderr: `${value}\n` };
            if (!native.error) {
                const operands = [first!, second!].map(operand => {
                    const bracket = operand.indexOf("[");
                    const name = bracket < 0 ? operand : operand.slice(0, bracket);
                    return `inline:data:image/gif;base64,${animations.get(name)!.toString("base64")}${bracket < 0 ? "" : operand.slice(bracket)}`;
                });
                const reference = spawnSync("magick", ["compare", "-metric", metric!, ...operands, "null:"], { encoding: "utf8" });
                expect(reference.status).toBe(expected.exitCode);
                expect(reference.stderr.trim()).toBe(value);
            }
            expect(runCompareCliSync(args, animations)).toEqual(expected);
            expect(await runCompareCli(args, animations)).toEqual(expected);
            expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(expected);
        });
    }
}
