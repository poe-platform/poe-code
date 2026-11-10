import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI retains the first image's gamma.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-smush", "+smush", undefined]) {
        it.each([false, true])(`${mode} ${operation ?? "unjoined"}: first image gamma adjusted=%s`, async adjusted => {
            const argv = ["(", "-size", "2x3", "xc:#8040c080", ...(adjusted ? ["-gamma", "2"] : []), ")",
                "-size", "3x2", "xc:#30905040", ...(operation ? [operation, "0"] : []), "-format", "%[gamma];", "info:out"];
            const fs = new MemoryFileSystem();
            const previous = new TextEncoder().encode("KEEP");
            const files = new Map([["out", previous]]);
            await fs.writeFile("/out", previous);
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(new TextDecoder().decode(output)).toBe(`${adjusted ? "0.909091" : "0.454545"};${operation ? "" : "0.454545;"}`);
        });
    }
}
