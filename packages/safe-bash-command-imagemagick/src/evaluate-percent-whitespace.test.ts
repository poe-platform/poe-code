import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI, big-endian RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["20 %", "00145c5caaaa8080"],
        ["20\t%", "00145c5caaaa8080"],
        ["2e1 %", "00145c5caaaa8080"],
        ["20", "00145c5caaaa8080"],
        ["20%", "33335c5caaaa8080"],
        [" 20%", "33335c5caaaa8080"],
        ["20% ", "33335c5caaaa8080"],
        ["2e1%", "33335c5caaaa8080"],
    ])(`${mode}: distinguishes the percent suffix in %j`, async (operand, expected) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#345caa80", "-channel", "R", "-evaluate", "Set", operand,
            "+channel", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
