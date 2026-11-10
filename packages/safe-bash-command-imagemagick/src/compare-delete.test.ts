import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync, runConvertCli } from "./index.js";

const a = Uint8Array.from([...new TextEncoder().encode("P6\n3 2\n255\n"),
    20, 120, 90, 70, 50, 240, 165, 55, 35, 210, 140, 190, 180, 90, 60, 45, 210, 110]);
const b = a.slice();
b[20] = 82;

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels and RMSE.
const equalA = [208, 228, 222, 218, 214, 252, 237, 215, 211, 246, 232, 242, 240, 222, 216, 213, 246, 226];
const equalB = equalA.slice();
equalB[9] = 220;
const different = equalA.slice();
different.splice(9, 3, 235, 28, 62);
const cases = [
    { inputs: ["a.ppm", "a.ppm"], rgb: equalA },
    { inputs: ["a.ppm", "b.ppm"], rgb: different, differs: true },
    { inputs: ["(", "a.ppm", "b.ppm", "-delete", "0", ")", "b.ppm"], rgb: equalB },
    { inputs: ["(", "a.ppm", "b.ppm", "-delete", "1", ")", "b.ppm"], rgb: different, differs: true },
    { inputs: ["(", "a.ppm", "b.ppm", "-delete", "-1", ")", "a.ppm"], rgb: equalA },
    { inputs: ["a.ppm", "b.ppm", "-delete", "0", "b.ppm"], rgb: equalB },
    { inputs: ["a.ppm", "(", "b.ppm", "a.ppm", "-delete", "0", ")"], rgb: equalA },
    { inputs: ["a.ppm", "(", "b.ppm", "(", "a.ppm", "b.ppm", "-delete", "1", ")", "-delete", "0", ")"], rgb: equalA },
    { inputs: ["(", "a.ppm", "b.ppm", "+delete", ")", "a.ppm"], rgb: equalA },
    { inputs: ["a.ppm", "b.ppm", "a.ppm", "-delete", "0,1", "a.ppm"], rgb: equalA },
    { inputs: ["a.ppm", "b.ppm", "a.ppm", "-delete", "0-1", "a.ppm"], rgb: equalA },
    { inputs: ["a.ppm", "b.ppm", "-delete", "99"], rgb: different, differs: true },
    { inputs: ["a.ppm", "b.ppm", "-delete", "0-"], rgb: different, differs: true },
    { inputs: ["a.ppm", "b.ppm", "-delete", "1-,0"], rgb: different, differs: true },
    { inputs: ["pair.gif", "-delete", "0", "b.ppm"], rgb: equalB },
];

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const fixture of cases) {
        it(`${mode} compare deletes frames before selecting operands: ${fixture.inputs.join(" ")}`, async () => {
            const files = new Map([["a.ppm", a], ["b.ppm", b]]), filesystem = new MemoryFileSystem();
            if (fixture.inputs.includes("pair.gif")) expect((await runConvertCli(["a.ppm", "b.ppm", "pair.gif"], files)).exitCode).toBe(0);
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", "RMSE", ...fixture.inputs, "diff.ppm"];
            let stdout = "", stderr = "";
            const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
            const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
            const result = mode === "compare" || mode === "magick" ? { ...await command.execute({
                command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runCompareCliSync(args, files)
                : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(fixture.differs ? 1 : 0);
            expect(result.stderr.trim()).toBe(fixture.differs ? "7753.66 (0.118313)" : "0 (0)");
            expect(result.stdout).toBe("");
            const diff = decodeImage(mode === "sync" || mode === "buffered" ? files.get("diff.ppm")! : await filesystem.readFile("/diff.ppm"));
            expect([diff.width, diff.height]).toEqual([3, 2]);
            expect([...diff.data]).toEqual(fixture.rgb.flatMap((value, index) => index % 3 === 2 ? [value, 255] : [value]));
            expect(await filesystem.readFile("/a.ppm")).toEqual(a);
            expect(await filesystem.readFile("/b.ppm")).toEqual(b);
        });
    }
}

for (const retained of [false, true]) {
    for (const inputs of [
        ["a.ppm", "b.ppm", "-delete", "0-1"],
        ["a.ppm", "b.ppm", "-delete", "bad"],
        ["a.ppm", "b.ppm", ")"],
        ["(", "a.ppm", "b.ppm"],
        ["a.ppm", "(", "+delete", ")", "b.ppm"],
    ]) {
        it(`preserves output on invalid or insufficient stack (${retained}): ${inputs.join(" ")}`, async () => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["a.ppm", a], ["b.ppm", b], ["diff.ppm", original]]), filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const result = await runCompareCli([...inputs, "diff.ppm"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(2);
            expect(retained ? await filesystem.readFile("/diff.ppm") : files.get("diff.ppm")).toEqual(original);
        });
    }
}
