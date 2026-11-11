import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["P5", "P6"]) {
        for (const operator of ["-black-threshold", "-white-threshold"]) {
            it.each(["50%", "(50%)", "32768", "(32768)"])(`${mode}: ${format} ${operator} %s applies the cutoff`, async threshold => {
                const samples = [0, 64, 127, 192, 255];
                const input = Buffer.concat([
                    Buffer.from(`${format}\n5 1\n255\n`),
                    Buffer.from(format === "P5" ? samples : samples.flatMap(value => [value, value, value])),
                ]);
                const files = new Map<string, Uint8Array>([["input.pnm", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.pnm", input);
                const argv = ["input.pnm", "-channel", "RGB", operator, threshold, "-depth", "8", "rgb:output"];
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command"
                    ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                        stdin: (async function* () {})(), stdout: { async write() {} },
                        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                        registerCleanup() {}, fs: filesystem,
                    } as unknown as CommandContext)
                    : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/output") : files.get("output")!;
                // Native ImageMagick 7.1.2 Q16-HDRI output for the same PGM/PPM bytes and arguments.
                expect(Buffer.from(output).toString("hex")).toBe(operator === "-black-threshold"
                    ? "000000000000000000c0c0c0ffffff"
                    : "0000004040407f7f7fffffffffffff");
            });
        }
    }
}
