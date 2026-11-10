import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const operation of ["-splice", "-shave"]) {
        for (const format of ["info", "rgba"]) {
            it.each(["2+1", "2-1", "2+0", "2+1+0", "2-1-0", "bad"])(`rejects ${operation} scalar offsets without overwriting ${format} output (${mode}): %s`, async geometry => {
                const original = new TextEncoder().encode("KEEP");
                const files = new Map([["/out", original]]), fs = new MemoryFileSystem();
                await fs.writeFile("/out", original);
                const argv = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", `${format}:/out`];
                let stderr = "";
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out");
                expect({ exitCode: result.exitCode, output }).toEqual({ exitCode: 1, output: original });
                expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${operation}'`);
            });
        }

        it.each([
            { geometry: "2", expected: operation === "-splice" ? "5x4" : "3x2" },
            { geometry: "2x1+1", expected: operation === "-splice" ? "5x3" : "3x4" },
            { geometry: "2x1-1", expected: operation === "-splice" ? "5x3" : "3x4" },
        ])(`accepts ${operation} scalar sizes and dimension pairs with offsets (${mode}): $geometry`, async ({ geometry, expected }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["-size", operation === "-splice" ? "3x2" : "7x6", "xc:red", operation, geometry, "-format", "%wx%h", "info:/out"];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out");
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
