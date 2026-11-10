import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps the separate alpha sample when adding transparent padding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const evaluate of [false, true]) for (const depth of [8, 16]) {
        it.each([
            { alpha: "Discrete", operation: "-border", geometry: "1x0", output: "separate", expected: "006000" },
            { alpha: "Disassociate", operation: "-border", geometry: "1x0", output: "separate", expected: "006000" },
            { alpha: "Discrete", operation: "-border", geometry: "1x0", output: "activate", expected: "000000008040206000000000" },
            { alpha: "On", operation: "-border", geometry: "1x0", output: "separate", expected: "006000" },
            { alpha: "Discrete", operation: "-extent", geometry: "2x1", output: "separate", expected: "6000" },
            { alpha: "Off", operation: "-border", geometry: "1x0", output: "activate", expected: "00000000804020ff00000000" },
        ])(`${mode}: $alpha $operation then $output (evaluate=${evaluate}, depth=${depth})`, async ({ alpha, operation, geometry, output, expected }) => {
            const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = ["xc:#80402060", ...(evaluate ? ["-evaluate", "Add", "0"] : []), "-alpha", alpha, "-background", "none", "-bordercolor", "none", operation, geometry,
                ...(output === "separate" ? ["-channel", "A", "-separate", "+channel"] : ["-alpha", "Activate"]),
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
