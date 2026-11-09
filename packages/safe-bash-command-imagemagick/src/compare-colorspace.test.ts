import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const input = (changed: boolean) => new Uint8Array([
    ...new TextEncoder().encode("P6\n3 2\n255\n"),
    20, 120, 90, 70, 50, 240, 165, 55, 35, changed ? 82 : 210, 140, 190, 180, 90, 60, 45, 210, 110
]);
// ImageMagick 7.1.2-35 Q16-HDRI, decoded to 8-bit RGB.
const cases = [
    ["sRGB", "7753.66 (0.118313)", [208,228,222,218,214,252,237,215,211,235,28,62,240,222,216,213,246,226]],
    ["RGB", "8651.78 (0.132018)", [204,214,209,207,206,248,223,206,205,226,13,50,227,209,206,205,237,212]],
    ["Gray", "2855.92 (0.0435785)", [223,223,223,218,218,218,219,219,219,56,56,56,225,225,225,238,238,238]],
    ["Lab", "2990.48 (0.0456318)", [255,123,0,255,55,64,255,84,0,0,255,255,255,96,0,255,153,0]],
] as const;
for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    for (const [space, metric, pixels] of cases) {
        it(`compares in ${space}, including the diff (${mode})`, async () => {
            const files = new Map([["a.ppm", input(false)], ["b.ppm", input(true)]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["-metric", "RMSE", "-colorspace", space, "a.ppm", "b.ppm", "diff.ppm"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
                const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                let stdout = "", stderr = "";
                result = { ...await command.execute({ command: command.name, args: args.args, argumentValues: args,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }), stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(argv, files)
                : await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 1, stdout: "", stderr: metric });
            const read = (name: string) => mode === "sync" || mode === "memory" ? files.get(name)! : filesystem.readFile(`/${name}`);
            const diff = decodeImage(await read("diff.ppm"));
            expect([...diff.data].filter((_, index) => index % 4 !== 3)).toEqual(pixels);
            expect(await read("a.ppm")).toEqual(input(false));
            expect(await read("b.ppm")).toEqual(input(true));
        });
    }
}
for (const retained of [false, true]) {
    for (const [channel, metric, pixels] of [["C", "65535 (1)", [62,255,255]], ["M", "65535 (1)", [255,204,255]], ["Y", "0 (0)", [255,255,0]], ["K", "0 (0)", [255,255,255]], ["Black", "0 (0)", [255,255,255]], ["CMYK", "46340.2 (0.707107)", [62,204,180]]] as const) {
        it(`selects ${channel} after CMYK conversion (retained=${retained})`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            expect(await runCompareCli(["-colorspace", "CMYK", "-channel", channel, "xc:red", "xc:lime", "diff.ppm"], retained ? { filesystem, cwd: "/" } : files))
                .toMatchObject({ exitCode: metric === "0 (0)" ? 0 : 1, stderr: metric });
            expect([...decodeImage(retained ? await filesystem.readFile("/diff.ppm") : files.get("diff.ppm")!).data]).toEqual([...pixels, 255]);
        });
    }
    it(`preserves equality and rejects invalid colorspaces before writing (retained=${retained})`, async () => {
        const files = new Map([["a.ppm", input(false)], ["out.ppm", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const context = retained ? { filesystem, cwd: "/" } : files;
        for (const [space] of cases) expect(await runCompareCli(["-colorspace", space, "a.ppm", "a.ppm", "null:"], context)).toMatchObject({ exitCode: 0, stderr: "0 (0)" });
        for (const args of [["-colorspace"], ["-colorspace", "bogus", "a.ppm", "a.ppm", "out.ppm"]])
            expect(await runCompareCli(args, context)).toMatchObject({ exitCode: 2 });
        expect(retained ? await filesystem.readFile("/out.ppm") : files.get("out.ppm")).toEqual(new TextEncoder().encode("KEEP"));
    });
}

for (const retained of [false, true]) {
    for (const [channel, a, b, metric] of [
        ["K", "#808080", "black", "32896 (0.501961)"],
        ["A", "#808080", "black", "0 (0)"],
        ["K", "#80808080", "#808080ff", "16255.5 (0.248043)"],
        ["A", "#80808080", "#808080ff", "32639 (0.498039)"],
        ["All", "#80808080", "#808080ff", "16306.7 (0.248825)"],
    ]) it(`keeps black and alpha independent: ${channel}, ${a}, ${b} (retained=${retained})`, async () => {
        expect(await runCompareCli(["-colorspace", "CMYK", "-channel", channel!, `xc:${a}`, `xc:${b}`, "null:"],
            retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map()))
            .toMatchObject({ exitCode: metric === "0 (0)" ? 0 : 1, stderr: metric });
    });
    for (const [metric, expected] of [
        ["RMSE", "7837.4 (0.119591)"], ["MAE", "2217.99 (0.0338444)"], ["MSE", "937.284 (0.014302)"],
        ["PAE", "37251.5 (0.568421)"], ["Fuzz", "5623.7 (0.0858122)"], ["MEPP", "2217.99 (0.0338444, 0.568421)"],
        ["SSIM", "2007.55 (0.0306332)"], ["NCC", "2274.75 (0.0347105)"], ["DPC", "2274.75 (0.0347105)"],
        ["PDC", "1 (0.166667)"], ["AE", "0.203066 (0.0338444)"], ["PHASE", "1516.92 (0.0231467)"],
        ["PHASH", "2.48582 (2.48582)"],
    ]) it(`measures ${metric} with CMYK channels (retained=${retained})`, async () => {
        const files = new Map([["a.ppm", input(false)], ["b.ppm", input(true)]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        expect(await runCompareCli(["-colorspace", "CMYK", "-metric", metric!, "a.ppm", "b.ppm", "null:"], retained ? { filesystem, cwd: "/" } : files))
            .toMatchObject({ exitCode: 1, stderr: expected });
    });
}

for (const retained of [false, true]) it(`preserves 16-bit CMYK samples across read chunks (retained=${retained})`, async () => {
    const header = new TextEncoder().encode("P6\n1025 1\n65535\n");
    const a = new Uint8Array(header.length + 1025 * 6);
    a.set(header);
    for (let offset = header.length; offset < a.length; offset += 2) a[offset] = 128;
    const b = a.slice(); b.fill(255, b.length - 6);
    const files = new Map([["a.ppm", a], ["b.ppm", b]]), filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    expect(await runCompareCli(["-colorspace", "CMYK", "-channel", "K", "-depth", "16", "a.ppm", "b.ppm", "diff.ppm"],
        retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 1, stderr: "1023.47 (0.0156171)" });
    const diff = decodeImage(retained ? await filesystem.readFile("/diff.ppm") : files.get("diff.ppm")!);
    expect(diff.width).toBe(1025);
    expect([...diff.data16!.slice(-4)]).toEqual([58982, 58982, 58982, 65535]);
});
