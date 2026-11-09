import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["invalid", "Dilate", "", "Maximum", "mAxImUm"])(`${mode}: validates statistic %s before replacing output`, async statistic => {
        const input = Uint8Array.from([80, 53, 10, 55, 32, 53, 10, 50, 53, 53, 10, 22, 82, 156, 5, 107, 223, 114, 19, 177, 110, 57, 18, 232, 221, 224, 2, 33, 78, 137, 210, 58, 159, 35, 164, 68, 225, 157, 103, 63, 37, 25, 27, 43, 73, 117]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.pgm", input], ["/out.pgm", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        await fs.writeFile("/out.pgm", original);
        const argv = ["/in.pgm", "-statistic", statistic, "3x3", "/out.pgm"];
        let exitCode: number, stdout = "", stderr = "";
        if (mode === "command") {
            const args = createCommandArguments(argv);
            ({ exitCode } = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }));
        } else {
            ({ exitCode, stdout, stderr } = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files));
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.pgm") : files.get("/out.pgm")!;
        expect(stdout).toBe("");
        if (statistic.toLowerCase() !== "maximum") {
            expect(exitCode).toBe(1);
            expect(stderr).toContain("unrecognized statistic type");
            expect(stderr).toContain(`'${statistic}'`);
            expect(output).toEqual(original);
        } else {
            expect(exitCode).toBe(0);
            expect(stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Maximum 3x3 control.
            expect([...decodeImage(output).data]).toEqual([
                177, 177, 177, 156, 232, 232, 232,
                224, 224, 177, 156, 232, 232, 232,
                224, 224, 177, 225, 232, 232, 232,
                224, 224, 164, 225, 225, 225, 210,
                159, 164, 164, 225, 225, 225, 157
            ].flatMap(value => [value, value, value, 255]));
        }
    });
}
