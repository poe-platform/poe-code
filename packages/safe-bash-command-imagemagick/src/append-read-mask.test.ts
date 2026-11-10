import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI clears read-mask selection during append.
const cases = [
    { name: "mask before append", before: ["-read-mask", "xc:white"], after: [], expected: "0" },
    { name: "mask after append", before: [], after: ["-read-mask", "xc:white"], expected: "0.12549" },
    { name: "mask removed after append", before: ["-read-mask", "xc:white"], after: ["+read-mask"], expected: "0.12549" },
    { name: "unmasked control", before: [], after: [], expected: "0.12549" },
    { name: "pixels after removing mask", before: ["-read-mask", "xc:white"], after: ["+read-mask"], raw: true, expected: "2060b080" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operation of ["-append", "+append"]) {
        it.each(cases)(`matches single-frame ${operation} read masks: $name, ${mode}`, async ({ before, after, raw, expected }) => {
            const files = new Map([["out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", Buffer.from("KEEP"));
            const argv = ["xc:#2060b080", ...before, operation, ...after,
                ...(raw ? ["-depth", "8", "rgba:out"] : ["-format", "%[fx:mean.r]", "info:out"])];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(Buffer.from(bytes).toString(raw ? "hex" : "utf8")).toBe(expected);
        });
    }
}
