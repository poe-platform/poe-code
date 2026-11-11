import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete 5x3 RGBA output from ImageMagick 7.1.2-35 Q16-HDRI.
const horizontal = "0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff800080ffff0000ff800080ff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff";
const vertical = "0000ffff0000ffff800080ff0000ffff0000ffff0000ffff0000ffffff0000ff0000ffff0000ffff0000ffff0000ffff800080ff0000ffff0000ffff";
const diagonal = "0000ffff3f00c0ff1e00e1ff0000ffff0000ffff0000ffff5000afffff0000ff5000afff0000ffff0000ffff0000ffff1e00e1ff3f00c0ff0000ffff";
const circular = "0000ffff4b00b4ff800080ff4b00b4ff0000ffff0000ffff800080ffff0000ff800080ff0000ffff0000ffff4b00b4ff800080ff4b00b4ff0000ffff";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { defines: ["radii=2,1"], expected: horizontal },
        { defines: ["radii=2,1", "angle=0"], expected: horizontal },
        { defines: ["radii=2,1", "angle=90"], expected: vertical },
        { defines: ["radii=2,1", "angle=33"], expected: diagonal },
        { defines: ["radii=2,1", "angle=393"], expected: diagonal },
        { defines: ["radii=2,1", "angle=-33"], expected: "0000ffff0000ffff1e00e1ff3f00c0ff0000ffff0000ffff5000afffff0000ff5000afff0000ffff0000ffff3f00c0ff1e00e1ff0000ffff0000ffff" },
        { defines: ["radii=2,2", "angle=0"], expected: circular },
        { defines: ["radii=2,2", "angle=33"], expected: circular },
        { defines: ["radii=2,2", "angle=90"], expected: circular },
        { defines: ["extent=ellipse", "angle=33"], expected: diagonal },
        { defines: ["radii=2,1", "angle=33", "center=1,1"], expected: "3f00c0ff1e00e1ff0000ffff0000ffff0000ffff5000afffff0000ff5000afff0000ffff0000ffff0000ffff1e00e1ff3f00c0ff0000ffff0000ffff" },
        { defines: ["radii=2,1", "angle=33", "vector=0,0,4,2"], expected: diagonal },
        { defines: ["radii=2,1", "angle=33", "vector=1,1,3,1"], expected: "2300dcff9f0060ff4e00b1ff0000ffff0000ffff0000ffff0000ffff9f0060ff2300dcff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff" },
    ])(`${mode}: radial gradient $defines`, async ({ defines, expected }) => {
        const argv = ["-size", "5x3", ...defines.flatMap(value => ["-define", `gradient:${value}`]), "radial-gradient:red-blue", "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let bytes: Buffer;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const stdout: Buffer[] = [], stderr: Buffer[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString("hex")).toBe(expected);
    });
}
