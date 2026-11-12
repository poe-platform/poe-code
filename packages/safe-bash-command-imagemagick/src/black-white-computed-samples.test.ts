import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const channels of [[], ["-channel", "RGB"]]) {
        for (const operator of ["-black-threshold", "-white-threshold"]) {
            it.each([
                { add: "32", cutoff: "39337", output: ["-depth", "8", "rgb:out"], black: "000000999999", white: "999999ffffff" },
                { add: "0.25", cutoff: "39321.125", output: ["-precision", "14", "-format", "%k:%[fx:p{0,0}.b*65535],%[fx:p{1,0}.b*65535]", "info:"], black: "2:0,39321.25", white: "2:39321,65535" },
            ])(`${mode}: ${channels.join(" ")} ${operator} preserves computed $add quantum samples`, async ({ add, cutoff, output, black, white }) => {
                const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
                const argv = ["-size", "1x1", "xc:#999999", "(", "+clone", "-evaluate", "add", add, ")", "+append", ...channels, operator, cutoff, ...output];
                const args = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const actual = output.at(-1) === "info:" ? ("stdout" in result ? result.stdout : stdout)
                    : Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!).toString("hex");
                expect(actual).toBe(operator === "-black-threshold" ? black : white);
            });
        }
    }
}
