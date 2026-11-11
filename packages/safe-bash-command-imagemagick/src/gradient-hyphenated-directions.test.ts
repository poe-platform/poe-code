import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI reference bytes, 5x3 grayscale in row order.
const directions = [
    { names: ["NorthEast", "North-East", "nOrTh-eAsT"], expected: "ff800080ffffb480b4ffffffffffff" },
    { names: ["SouthWest", "South-West", "sOuTh-wEsT"], expected: "80b4ffffff0080ffffff80b4ffffff" },
    { names: ["NorthWest", "North-West", "nOrTh-wEsT"], expected: "0080ffffff80b4ffffffffffffffff" },
    { names: ["SouthEast", "South-East", "sOuTh-eAsT"], expected: "ffb480b4ffff800080ffffb480b4ff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { names, expected } of directions) {
        it.each(names)(`${mode}: radial gradient direction %s`, async (direction) => {
            const argv = ["-size", "5x3", "-define", `gradient:direction=${direction}`, "radial-gradient:black-white", "-depth", "8", "gray:-"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let bytes: Buffer;
            if (mode === "command") {
                const argumentValues = createCommandArguments(argv);
                const stdout: Buffer[] = [], stderr: Buffer[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(stderr).toString()).toBe("");
                bytes = Buffer.concat(stdout);
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
            }
            expect(bytes.toString("hex")).toBe(expected);
        });
    }
}
