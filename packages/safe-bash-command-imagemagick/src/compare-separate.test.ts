import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const rgb = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];
const ppm = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...rgb]);
const plane = (channel: number) => new Uint8Array([...new TextEncoder().encode("P5\n3 2\n255\n"), ...rgb.filter((_, index) => index % 3 === channel)]);

for (const mode of ["sync", "async", "retained", "command"] as const) {
    it.each(["R", "G", "B"])(`separates %s into an independent grayscale operand (${mode})`, async channel => {
        const files = new Map([["/a.ppm", ppm], ["/plane.pgm", plane("RGB".indexOf(channel))]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-metric", "RMSE", "(", "/a.ppm", "-channel", channel, "-separate", "+channel", ")", "/plane.pgm", "/diff.ppm"];
        let stdout = "", stderr = "";
        const args = createCommandArguments(["compare", ...argv]);
        const result = mode === "sync" ? runCompareCliSync(argv, files)
            : mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
            : await runCompareCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(mode === "command" ? { ...result, stdout, stderr } : result).toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0)\n" });
        expect(decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/diff.ppm") : files.get("/diff.ppm")!)).toMatchObject({ width: 3, height: 2 });
    });
}

it("limits separation to the current nested group and keeps channel samples distinct", async () => {
    const files = new Map([["a.ppm", ppm], ["red.pgm", plane(0)]]);
    expect(await runCompareCli(["red.pgm", "(", "(", "a.ppm", "-channel", "R", "-separate", "+channel", ")", ")", "null:"], files))
        .toMatchObject({ exitCode: 0, stderr: "0 (0)\n" });
    expect(await runCompareCli(["(", "a.ppm", "-channel", "G", "-separate", "+channel", ")", "red.pgm", "null:"], files))
        .toMatchObject({ exitCode: 1, stderr: "2570 (0.0392157)\n" });
});

it.each([["(", "a.ppm", "a.ppm"], ["a.ppm", ")", "a.ppm"]])("rejects unbalanced groups without replacing output: %j", async (...args) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["a.ppm", ppm], ["diff.ppm", keep]]);
    expect(await runCompareCli([...args, "diff.ppm"], files)).toMatchObject({ exitCode: 2 });
    expect(files.get("diff.ppm")).toEqual(keep);
});

for (const bits of [8, 16]) {
    it(`preserves ${bits}-bit separation, channel order and leading operators against native`, async () => {
        const max = bits === 16 ? 65535 : 255;
        const samples = [18, 29, 40, 19, 30, 41];
        const image = new Uint8Array([...new TextEncoder().encode(`P6\n2 1\n${max}\n`),
            ...samples.flatMap(value => bits === 16 ? [18, value] : [value])]);
        const gray = new Uint8Array([...new TextEncoder().encode(`P5\n2 1\n${max}\n`),
            ...[18, 19].flatMap(value => bits === 16 ? [18, value] : [value])]);
        const files = new Map([["a.ppm", image], ["red.pgm", gray]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        for (const args of [
            ["(", "a.ppm", "-channel", "R", "-separate", "+channel", ")", "red.pgm", "null:"],
            ["-channel", "R", "-separate", "a.ppm", "red.pgm", "null:"],
            ["a.ppm", "-channel", "G,R", "-separate", "+channel", "null:"],
            ["a.ppm", "-separate", "null:"],
        ]) {
            const result = await runCompareCli(args, files);
            expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
            expect(runCompareCliSync(args, files)).toEqual(result);
            expect(result.exitCode).toBe(args.includes("red.pgm") ? 0 : 1);
            const native = spawnSync("magick", ["compare", ...args.map(arg => files.has(arg)
                ? `inline:data:image/ppm;base64,${Buffer.from(files.get(arg)!).toString("base64")}` : arg)], { encoding: "utf8" });
            if (!native.error) {
                expect(result.stderr.trim()).toBe(native.stderr.trim());
                expect(result.exitCode).toBe(native.status);
            }
        }
    });
}

it("matches the reported red and green planes and the changed red-plane RMSE", async () => {
    const samples = [20, 120, 90, 70, 50, 240, 165, 55, 35, 210, 140, 190, 180, 90, 60, 45, 210, 110];
    const changed = samples.slice();
    changed[9] = 82;
    const files = new Map([
        ...[samples, changed].map((values, index) => [index ? "b.ppm" : "a.ppm", new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...values])] as const),
        ...[0, 1].map(channel => [channel ? "green.pgm" : "red.pgm", new Uint8Array([...new TextEncoder().encode("P5\n3 2\n255\n"), ...samples.filter((_, index) => index % 3 === channel)])] as const),
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    for (const [input, channel, reference, stderr, exitCode] of [
        ["a.ppm", "R", "red.pgm", "0 (0)\n", 0],
        ["a.ppm", "G", "green.pgm", "0 (0)\n", 0],
        ["b.ppm", "R", "red.pgm", "13429.7 (0.204925)\n", 1],
    ] as const) {
        const args = ["-metric", "RMSE", "(", input, "-channel", channel, "-separate", "+channel", ")", reference, "diff.ppm"];
        expect(await runCompareCli(args, files)).toMatchObject({ exitCode, stderr });
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode, stderr });
    }
});
