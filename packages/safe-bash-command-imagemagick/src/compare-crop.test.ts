import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

const header = new TextEncoder().encode("P5\n4 2\n255\n");
const fixtures = new Map([
    ["a.pgm", new Uint8Array([...header, 10, 20, 30, 40, 50, 60, 70, 80])],
    ["b.pgm", new Uint8Array([...header, 10, 20, 30, 200, 50, 60, 70, 80])]
]);

for (const mode of ["sync", "async", "magick", "retained"] as const) {
    it(`applies compare crops in operand order (${mode})`, async () => {
        for (const [args, metric, width] of [
            [["-crop", "2x2+0+0", "a.pgm", "b.pgm"], "0 (0)", 2],
            [["-crop", "2x2+2+0", "a.pgm", "b.pgm"], "20560 (0.313725)", 2],
            [["a.pgm", "-crop", "2x2+0+0", "b.pgm"], "16506.1 (0.251867)", 4],
            [["a.pgm", "-crop", "2x2+2+0", "b.pgm"], "15040.5 (0.229504)", 4],
            [["a.pgm", "b.pgm", "-crop", "2x2+0+0"], "0 (0)", 2],
            [["-crop", "2x2+0+0", "a.pgm", "+crop", "b.pgm"], "16506.1 (0.251867)", 4],
            [["-crop", "2x2", "a.pgm", "b.pgm"], "5140 (0.0784314)", 2],
            [["-gravity", "West", "-crop", "50x100%", "a.pgm", "b.pgm"], "0 (0)", 2],
            [["-gravity", "East", "-crop", "50x100%", "a.pgm", "b.pgm"], "20560 (0.313725)", 2],
            [["-crop", "50x100%", "a.pgm", "b.pgm"], "5140 (0.0784314)", 2],
            [["-gravity", "East", "+gravity", "-crop", "50x100%", "a.pgm", "b.pgm"], "5140 (0.0784314)", 2],
            [["-gravity", "None", "-crop", "50x100%", "a.pgm", "b.pgm"], "5140 (0.0784314)", 2],
            [["-gravity", "West", "-crop", "2x2+0+0", "a.pgm", "b.pgm"], "0 (0)", 2],
            [["-crop", "2x2+0+0", "-gravity", "East", "a.pgm", "b.pgm"], "20560 (0.313725)", 2],
            [["-gravity", "East", "-crop", "2x2+0+0", "a.pgm", "b.pgm"], "20560 (0.313725)", 2]
        ] as const) {
            const files = new Map(fixtures);
            const filesystem = new MemoryFileSystem();
            for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
            const argv = ["-metric", "RMSE", ...args, "diff.png"];
            const result = mode === "sync" ? runCompareCliSync(argv, files)
                : mode === "magick" ? await runMagickCli(["compare", ...argv], files)
                : await runCompareCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ ...result, stderr: result.stderr.trim() }, args.join(" ")).toEqual({ exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: metric });
            const output = mode === "retained" ? await filesystem.readFile("/diff.png") : files.get("diff.png")!;
            expect(await sharp(output).metadata()).toMatchObject({ width, height: 2 });
            if (metric === "0 (0)") expect(Array.from(await sharp(output).removeAlpha().raw().toBuffer()))
                .toEqual([206, 208, 214, 216].flatMap(value => [value, value, value]));
        }
    });
}

for (const options of [["-crop"], ["-crop", "bogus"], ["-gravity"], ["-gravity", "bogus"]]) {
    it(`preserves the destination for invalid options: ${options.join(" ")}`, async () => {
        const files = new Map(fixtures);
        const keep = new TextEncoder().encode("KEEP");
        files.set("diff.png", keep);
        const args = ["a.pgm", "b.pgm", "diff.png", ...options];
        expect(runCompareCliSync(args, files).exitCode).toBe(2);
        expect(files.get("diff.png")).toEqual(keep);
        const filesystem = new MemoryFileSystem();
        for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
        expect((await runCompareCli(args, { filesystem, cwd: "/" })).exitCode).toBe(2);
        expect(await filesystem.readFile("/diff.png")).toEqual(keep);
    });
}

it("applies gravity crops through the public magick command", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a.pgm", new Uint8Array([...header, 0, 0, 0, 0, 0, 0, 0, 0]));
    await fs.writeFile("/b.pgm", new Uint8Array([...header, 0, 0, 0, 255, 0, 0, 0, 0]));
    for (const gravity of ["West", "East"]) {
        const args = createCommandArguments(["compare", "-metric", "RMSE", "-gravity", gravity, "-crop", "2x2+0+0", "a.pgm", "b.pgm", "diff.png"]);
        let stderr = "";
        const result = await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        expect(result).toEqual({ exitCode: gravity === "West" ? 0 : 1 });
        expect(stderr).toBe(gravity === "West" ? "0 (0)" : "32767.5 (0.5)");
        expect(await sharp(await fs.readFile("/diff.png")).metadata()).toMatchObject({ width: 2, height: 2 });
    }
});
