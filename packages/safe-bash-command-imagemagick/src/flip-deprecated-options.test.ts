import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: plus forms fail with 1; unknown options fail with 11.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const destination of ["-", "out"]) {
        it.each([
            { option: "+flip", exitCode: 1 },
            { option: "+flop", exitCode: 1 },
            { option: "-flop", exitCode: 0 },
            { option: "+bogus", exitCode: 11 }
        ])(`matches native status and RGB output for $option (${mode}, ${destination})`, async ({ option, exitCode }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const args = ["xc:red", "xc:blue", "+append", option, "-depth", "8", `rgb:${destination}`];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(exitCode);
            expect("stderr" in result ? result.stderr : stderr).toBe(exitCode === 0 ? ""
                : exitCode === 1 ? `magick: option deprecated, unable to execute '${option}'\n`
                    : `magick: unrecognized option '${option}'\n`);
            const pixels = Uint8Array.from([0, 0, 255, 255, 0, 0]);
            const output = "stdout" in result ? result.stdoutBytes ?? new TextEncoder().encode(result.stdout) : Buffer.concat(stdout);
            expect(Array.from(output)).toEqual(exitCode === 0 && destination === "-" ? Array.from(pixels) : []);
            expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out"))
                .toEqual(exitCode === 0 && destination === "out" ? pixels : original);
        });
    }
}
