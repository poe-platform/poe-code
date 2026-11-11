import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI clears hidden RGB only in the composited interior.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { name: "Over with alpha disabled", compose: "Over", border: "1x0", alphaOff: true, expected: "2698ba0000002698ba" },
            { name: "Over with alpha retained", compose: "Over", border: "1x0", alphaOff: false, expected: "2698ba00000000002698ba00" },
            { name: "Over with zero border", compose: "Over", border: "0", alphaOff: false, expected: "00000000" },
            { name: "SrcOver alias", compose: "SrcOver", border: "1x0", alphaOff: true, expected: "2698ba0000002698ba" },
            { name: "Src preserves hidden source RGB", compose: "Src", border: "1x0", alphaOff: true, expected: "2698babe6a302698ba" },
            { name: "standalone Over composite", compose: "Over", border: undefined, alphaOff: false, expected: "00000000" },
        ])(`${mode}: $name (depth=${depth})`, async ({ compose, border, alphaOff, expected }) => {
            const argv = [...(border === undefined ? ["xc:#2698ba00"] : []), "xc:#be6a3000",
                "-bordercolor", "#2698ba00", "-compose", compose,
                ...(border === undefined ? ["-composite"] : ["-border", border]),
                ...(alphaOff ? ["-alpha", "off"] : []), "-depth", String(depth), `${alphaOff ? "rgb" : "rgba"}:-`];
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let bytes: Buffer;
            if (mode === "command") {
                const argumentValues = createCommandArguments(argv), stdout: Buffer[] = [], stderr: Buffer[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(stderr).toString()).toBe("");
                bytes = Buffer.concat(stdout);
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
            }
            const samples = [...Buffer.from(expected, "hex")];
            expect([...bytes]).toEqual(depth === 16 ? samples.flatMap(value => [value, value]) : samples);
        });
    }
}
