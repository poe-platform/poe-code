import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI activates transparent border alpha after alpha Off.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { output: "activate", background: "none", expected: "00000000804020ff00000000" },
            { output: "direct", background: "none", expected: "00000000804020ff00000000" },
            { output: "separate", background: "none", expected: "00ff00" },
            { output: "direct", background: "white", expected: "ffffffff804020ffffffffff" },
        ])(`${mode}: border after alpha Off then $output on $background (depth=${depth})`, async ({ output, background, expected }) => {
            const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = ["xc:#80402060", "-alpha", "Off", "-background", background, "-bordercolor", background, "-border", "1x0",
                ...(output === "separate" ? ["-channel", "A", "-separate", "+channel"] : output === "activate" ? ["-alpha", "Activate"] : []),
                "-depth", String(depth), `${output === "separate" ? "gray" : "rgba"}:out`];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const samples = Array.from(Buffer.from(expected, "hex"));
            expect(Array.from(bytes)).toEqual(depth === 16 ? samples.flatMap(value => [value, value]) : samples);
        });
    }
}
