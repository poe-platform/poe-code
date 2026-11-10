import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-smush", "+smush", "control"]) {
        it.each([
            { name: "delay", settings: ["-delay", "17"], expected: "17 Undefined;" },
            { name: "disposal", settings: ["-dispose", "Background"], expected: "0 Background;" },
            { name: "exact ticks", settings: ["-delay", "17x2000", "-dispose", "Previous"], expected: "17 Previous;" },
        ])(`${mode}: ${operation} retains source $name`, async ({ settings, expected }) => {
            // ImageMagick 7.1.2-35: smush retains the first frame's animation properties.
            const argv = [...settings, "-size", "2x3", "xc:#8040c080", "-size", "3x2", "xc:#30905040",
                ...(operation === "control" ? [] : [operation, "0"]), "-format", "%T %D;", "info:/out"];
            const files = new Map<string, Uint8Array>([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected.repeat(operation === "control" ? 2 : 1));
        });
    }
}
