import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const pgm = (width: number, height: number, pixels: number[]) => new Uint8Array([
    ...new TextEncoder().encode(`P5\n${width} ${height}\n255\n`), ...pixels
]);
const body = [20, 100, 210, 60, 160, 230];
const fixtures = new Map([
    ["body.pgm", pgm(3, 2, body)],
    ["other.pgm", pgm(3, 2, [20, 100, 210, 60, 140, 230])],
    ["noisy.pgm", pgm(5, 4, [0, 0, 5, 0, 0, 0, ...body.slice(0, 3), 0, 0, ...body.slice(3), 0, 0, 0, 0, 0, 0])],
    ["framed.pgm", pgm(5, 4, [0, 0, 0, 0, 0, 0, ...body.slice(0, 3), 0, 0, ...body.slice(3), 0, 0, 0, 0, 0, 0])]
]);

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    for (const [inputs, metric, width, height] of [
        [["(", "framed.pgm", "-trim", ")", "body.pgm"], "0 (0)", 3, 2],
        [["(", "framed.pgm", "-trim", ")", "other.pgm"], "2098.4 (0.0320195)", 3, 2],
        [["body.pgm", "(", "framed.pgm", "-trim", ")"], "0 (0)", 3, 2],
        [["(", "noisy.pgm", "-fuzz", "5%", "-trim", ")", "-fuzz", "0", "body.pgm"], "0 (0)", 3, 2],
        [["(", "(", "framed.pgm", ")", "-trim", ")", "body.pgm"], "0 (0)", 3, 2],
        [["framed.pgm", "body.pgm"], "40447.9 (0.617196)", 5, 4],
        [["-trim", "framed.pgm", "body.pgm"], "0 (0)", 3, 2],
        [["framed.pgm", "body.pgm", "-trim"], "0 (0)", 3, 2],
        [["(", "framed.pgm", "-trim", ")", "framed.pgm"], "40447.9 (0.617196)", 5, 4]
    ] as const) {
        it(`trims comparison operands before measuring distortion: ${inputs.join(" ")} (${mode})`, async () => {
            const files = new Map(fixtures);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["-metric", "RMSE", ...inputs, "diff.pgm"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
                const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                let stdout = "", stderr = "";
                result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(argv, files)
                : await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
            expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: metric });
            const output = mode === "sync" || mode === "memory" ? files.get("diff.pgm")! : await filesystem.readFile("/diff.pgm");
            const diff = decodeImage(output);
            expect([diff.width, diff.height]).toEqual([width, height]);
            if (metric === "0 (0)") expect([...diff.data]).toEqual([208, 224, 246, 216, 236, 250].flatMap(gray => [gray, gray, gray, 255]));
            expect(files.get("framed.pgm")).toEqual(fixtures.get("framed.pgm"));
            expect(await filesystem.readFile("/framed.pgm")).toEqual(fixtures.get("framed.pgm"));
        });
    }
}

for (const inputs of [["(", "framed.pgm", "-trim", "body.pgm"], ["framed.pgm", "-trim", ")", "body.pgm"]]) {
    it(`preserves the destination for unbalanced parentheses: ${inputs.join(" ")}`, async () => {
        const files = new Map(fixtures), keep = new TextEncoder().encode("KEEP");
        files.set("diff.pgm", keep);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = [...inputs, "diff.pgm"];
        expect(runCompareCliSync(args, files).exitCode).toBe(2);
        expect(files.get("diff.pgm")).toEqual(keep);
        expect((await runCompareCli(args, { filesystem, cwd: "/" })).exitCode).toBe(2);
        expect(await filesystem.readFile("/diff.pgm")).toEqual(keep);
    });
}

for (const retained of [false, true]) {
    it(`preserves low 16-bit differences when trimming (retained=${retained})`, async () => {
        const pixels = [0x1234, 0x2345, 0x3456, 0x4567, 0x5678, 0x6789];
        const files = new Map<string, Uint8Array>();
        for (const [name, width, height, samples] of [
            ["body.pgm", 3, 2, pixels],
            ["other.pgm", 3, 2, pixels.map((sample, index) => sample + (index === 4 ? 1 : 0))],
            ["framed.pgm", 5, 4, [0, 0, 0, 0, 0, 0, ...pixels.slice(0, 3), 0, 0, ...pixels.slice(3), 0, 0, 0, 0, 0, 0]]
        ] as const) files.set(name, new Uint8Array([
            ...new TextEncoder().encode(`P5\n${width} ${height}\n65535\n`),
            ...samples.flatMap(sample => [sample >>> 8, sample & 255])
        ]));
        const direct = runCompareCliSync(["body.pgm", "other.pgm", "direct.pgm"], files);
        expect(direct.exitCode).toBe(1);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["(", "framed.pgm", "-trim", ")", "other.pgm", "diff.pgm"];
        const result = retained ? await runCompareCli(args, { filesystem, cwd: "/" }) : runCompareCliSync(args, files);
        expect(result).toEqual(direct);
        expect(retained ? await filesystem.readFile("/diff.pgm") : files.get("diff.pgm")).toEqual(files.get("direct.pgm"));
    });
}
