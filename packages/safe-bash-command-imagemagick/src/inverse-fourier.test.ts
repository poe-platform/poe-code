import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI without FFTW: validate the pair before the delegate.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of ["-ift", "+ift"]) {
        it.each([
            { name: "single input", inputs: ["a.ppm"], output: ["out.miff"], pair: false },
            { name: "single input to stdout", inputs: ["a.ppm"], output: ["-depth", "8", "rgb:-"], pair: false },
            { name: "pair to file", inputs: ["a.ppm", "b.ppm"], output: ["out.miff"], pair: true },
            { name: "pair to info", inputs: ["a.ppm", "b.ppm"], output: ["-format", "%wx%h:%p/%n %[fx:r];", "info:"], pair: true },
            { name: "pair to stdout", inputs: ["a.ppm", "b.ppm"], output: ["-depth", "8", "rgb:-"], pair: true },
            { name: "pair reduced by delete", inputs: ["a.ppm", "b.ppm", "+delete"], output: ["out.miff"], pair: false },
            { name: "single input in group", inputs: ["a.ppm", "(", "b.ppm"], output: [")", "out.miff"], pair: false },
        ])(`${mode}: ${operator} $name`, async ({ inputs, output, pair }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([
                ["a.ppm", new TextEncoder().encode("P3\n2 1\n255\n66 23 41  19 110 221\n")],
                ["b.ppm", new TextEncoder().encode("P3\n1 2\n255\n17 67 93  208 112 49\n")],
                ["out.miff", original]
            ]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const argv = [...inputs, operator, ...output];
            let stdout = "", stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect.soft(result.exitCode).toBe(1);
            expect.soft(result.stdout).toBe("");
            if (pair) {
                expect.soft(result.stderr).toContain("delegate library support not built-in `a.ppm' (FFTW)");
                expect.soft(result.stderr).toContain("no images");
            } else {
                expect.soft(result.stderr).toContain(`image sequence is required '${operator}'`);
                expect.soft(result.stderr).not.toContain("FFTW");
            }
            const destination = mode === "buffered" || mode === "sync" ? files.get("out.miff") : await fs.readFile("/out.miff");
            expect.soft(destination).toEqual(original);
        });
    }
}

it("keeps both input images readable without inverse Fourier", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n66 23 41  19 110 221\n"));
    await fs.writeFile("/b.ppm", new TextEncoder().encode("P3\n1 2\n255\n17 67 93  208 112 49\n"));
    expect(await runMagickCli(["a.ppm", "b.ppm", "-format", "%z:%[fx:r];", "info:"], { filesystem: fs, cwd: "/" }))
        .toEqual({ exitCode: 0, stdout: "8:0.258824;8:0.0666667;", stderr: "" });
});
