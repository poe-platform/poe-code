import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const operator of ["-distort", "+distort"]) {
        it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(`${mode}: ${operator} Barrel validates %i coefficients before writing`, async count => {
            const valid = [3, 4, 5, 6, 8, 10].includes(count);
            const coefficients = [0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 4].slice(0, count).join(" ");
            const argv = ["-size", "3x3", "xc:red", operator, "Barrel", coefficients, "out.png"];
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out.png", original]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out.png", original);
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" ? await runMagickCli(argv, files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(valid ? 0 : 1);
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png");
            if (valid) expect(output).not.toEqual(original);
            else {
                expect("stderr" in result ? result.stderr : stderr).toContain("Invalid Barrel arguments");
                expect(output).toEqual(original);
            }
        });
    }
}
