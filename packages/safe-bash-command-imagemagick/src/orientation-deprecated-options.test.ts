import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: plus forms fail with 1; unknown options fail with 11.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const destination of ["-", "out"]) {
        it.each([
            { option: "+auto-orient", exitCode: 1, hex: "" },
            { option: "+transpose", exitCode: 1, hex: "" },
            { option: "+transverse", exitCode: 1, hex: "" },
            { option: "-auto-orient", exitCode: 0, hex: "112233445566" },
            { option: "-transpose", exitCode: 0, hex: "114422553366" },
            { option: "-transverse", exitCode: 0, hex: "663355224411" },
            { option: "+bogus", exitCode: 11, hex: "" }
        ])(`matches native status and gray output for $option (${mode}, ${destination})`, async ({ option, exitCode, hex }) => {
            const original = new TextEncoder().encode("KEEP");
            const input = Buffer.from("50350a3320320a3235350a112233445566", "hex");
            const files = new Map<string, Uint8Array>([["in.pgm", input], ["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pgm", input);
            await filesystem.writeFile("/out", original);
            const args = ["in.pgm", option, "-depth", "8", `gray:${destination}`];
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
                : exitCode === 1 ? `magick: option deprecated, unable to execute '${option}' at CLI arg 2\n`
                    : `magick: unrecognized option '${option}'\n`);
            const pixels = Uint8Array.from(Buffer.from(hex, "hex"));
            const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string"
                    ? new TextEncoder().encode(result.stdout) : Buffer.concat(stdout);
            expect(Array.from(output)).toEqual(exitCode === 0 && destination === "-" ? Array.from(pixels) : []);
            expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out"))
                .toEqual(exitCode === 0 && destination === "out" ? pixels : original);
        });
    }
}
