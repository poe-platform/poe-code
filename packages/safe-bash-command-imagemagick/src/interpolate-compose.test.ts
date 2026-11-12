import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "translucent Interpolate", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"],
            compose: "Interpolate", operation: ["-composite"], expected: "231d3ca4" },
        { name: "opaque Interpolate", inputs: ["-size", "1x1", "xc:#aa4433", "xc:#2468ac"],
            compose: "Interpolate", operation: ["-composite"], expected: "66436dff" },
        { name: "bright Interpolate", inputs: ["-size", "1x1", "xc:#94daf5", "xc:#f6cc83"],
            compose: "Interpolate", operation: ["-composite"], expected: "cfecc2ff" },
        { name: "offset Interpolate flatten", inputs: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")", "-background", "#33553370"],
            compose: "Interpolate", operation: ["-flatten"], expected: "230c06740417399a0417399a" },
        { name: "Over control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"],
            compose: "Over", operation: ["-composite"], expected: "3d6196d8" },
        { name: "Dst control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"],
            compose: "Dst", operation: ["-composite"], expected: "aa443380" },
    ])(`${mode}: $name`, async ({ inputs, compose, operation, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = [...inputs, "-compose", compose, ...operation, "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
        expect(output.toString("hex")).toBe(expected);
    });
}
