import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const first = ["(", "-size", "2x1", "xc:#2060b080", ")"];
const second = ["(", "-size", "1x2", "xc:#c04020ed", ")"];

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps the first frame's gamma.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const direction of ["-append", "+append"]) {
        it.each([
            { name: "first frame only", args: [...first.slice(0, -1), "-set", "gamma", "0.8", ")", ...second], gamma: "0.8" },
            { name: "second frame only", args: [...first, ...second.slice(0, -1), "-set", "gamma", "0.8", ")"], gamma: "0.454545" },
            { name: "both frames", args: [...first, ...second, "-set", "gamma", "0.8"], gamma: "0.8" },
            { name: "single frame", args: [...first.slice(0, -1), "-set", "gamma", "0.8", ")"], gamma: "0.8" },
        ])(`${mode} ${direction}: $name`, async ({ args, gamma }) => {
            const fs = new MemoryFileSystem();
            const previous = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", previous]]);
            await fs.writeFile("/out", previous);
            const argv = [...args, direction, "-format", "%[gamma]", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(gamma);
        });
    }
}
