import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        it.each([
            ["+0x5", "214dbb", "47679d"],
            ["+0x5x40%", "2f66ce", "38568b"],
            ["+0X5", "214dbb", "47679d"],
            ["+0x2e", "0000ff", "787c83"],
            ["0x5", "345caa", "345caa"]
        ])(`${mode}: ${option} %s matches native strength parsing`, async (geometry, forward, inverse) => {
            // Native ImageMagick 7.1.2-31 Q16-HDRI, identical argv.
            const argv = ["xc:#345caa", option, geometry, "-depth", "8", "rgb:out"];
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(option === "-sigmoidal-contrast" ? forward : inverse);
        });
    }
}
