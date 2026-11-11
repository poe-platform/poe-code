import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rejects both mask forms with the original CLI argument position.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const prefix of [[], ["-depth", "8"]]) {
        it.each(["-mask", "+mask", "-write-mask"])(`handles %s (${mode}, prefix ${prefix.join(" ")})`, async option => {
            const pixels = Uint8Array.from({ length: 15 }, (_, i) => 17 + 13 * i);
            const input = Buffer.concat([Buffer.from("P5\n5 3\n255\n"), pixels]);
            const files = new Map([["in.pgm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            const args = ["in.pgm", ...prefix, option, ...(option === "+mask" ? [] : ["in.pgm"]), "-depth", "8", "gray:-"];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const supported = option === "-write-mask";
            expect(result.exitCode).toBe(supported ? 0 : 1);
            expect("stderr" in result ? result.stderr : stderr).toBe(supported ? ""
                : `magick: option deprecated, unable to execute '${option}' at CLI arg ${prefix.length + 2}\n`);
            const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string"
                    ? new TextEncoder().encode(result.stdout) : Buffer.concat(stdout);
            expect(Array.from(output)).toEqual(supported ? Array.from(pixels) : []);
        });
    }
}
