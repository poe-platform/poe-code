import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output for the same PPM input.
const cases = [
    { geometry: "3", expected: "2814e12814c32814e1a05087a050875028c32814c32814e1a05087a050875028a52814c32814e1a05087a05087" },
    { geometry: "3x1", expected: "2814e12814a52814a5281487a050875028c3281487a05087a05087783ca5783ca52814a52814a5281487a05087" },
];
const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 3\n255\n"),
    ...[1, 2, 3, 1, 4, 2, 1, 4, 4, 3, 3, 2, 1, 3, 4].flatMap(i => [i * 40, i * 20, 255 - i * 30]),
]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    async function run(args: string[]) {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out.rgb", keep]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        let stderr = "";
        const stdout: number[] = [];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async bytes => { stdout.push(...bytes); } },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            }), stderr, stdoutBytes: Uint8Array.from(stdout),
        } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const outputPath = args[0] === "mogrify" && result.exitCode === 0 ? "/in.rgb" : "/out.rgb";
        return { ...result, output: mode === "command" || mode === "retained" ? await filesystem.readFile(outputPath) : files.get(outputPath)! };
    }

    for (const { geometry, expected } of cases) {
        it.each([
            { options: ["-mode", geometry], warns: true },
            { options: ["-quiet", "-mode", geometry], warns: false },
            { options: ["-quiet", "+quiet", "-mode", geometry], warns: true },
            { options: ["-mode", geometry, "-quiet"], warns: true },
            { options: ["-statistic", "Mode", geometry], warns: false },
        ])(`${mode}: applies Mode ${geometry} with $options`, async ({ options, warns }) => {
            const result = await run(["/in.ppm", ...options, "-depth", "8", "rgb:-"]);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(expected);
            if (warns) expect(result.stderr).toContain('option has been replaced \'-mode\', use "-statistic Mode"');
            else expect(result.stderr).toBe("");
        });
    }

    it.each(["%[fx:3]", "bad"])(`${mode}: rejects literal mode geometry %s without replacing output`, async geometry => {
        const result = await run(["-quiet", "/in.ppm", "-mode", geometry, "-depth", "8", "/out.rgb"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`invalid argument for option '-statistic': ${geometry}`);
        expect(result.stdoutBytes?.length ?? 0).toBe(0);
        expect(result.output).toEqual(new TextEncoder().encode("KEEP"));
    });

    it(`${mode}: parses mode geometry as an argument in mogrify`, async () => {
        const result = await run(["mogrify", "-mode", "3x1", "-depth", "8", "-format", "rgb", "/in.ppm"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toContain('use "-statistic Mode"');
        expect(Buffer.from(result.output).toString("hex")).toBe(cases[1]!.expected);
    });
}
