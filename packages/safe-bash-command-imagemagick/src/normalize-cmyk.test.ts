import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, followed by +channel -depth 8 cmyk:-.
const cases = [
    { operations: ["-normalize"], expected: "ff0086fffffa005e0f009e41" },
    { operations: ["-channel", "Black", "-normalize"], expected: "d50055ffd595002414006200" },
    { operations: [], expected: "d500559fd595003f1400622f" },
    { operations: ["-contrast-stretch", "2%x1%"], expected: "ff0086fffffa005e0f009e41" },
    { operations: ["-equalize"], expected: "ff00aaffffaa00aa5500aa55" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: normalizes selected CMYK inks for $operations`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#106040", "xc:#2050c0", "xc:#c0d080", "+append", "-colorspace", "CMYK",
            ...operations, "+channel", "-depth", "8", "cmyk:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
