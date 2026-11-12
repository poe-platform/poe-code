import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Exact output captured with ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures = [
    {
        format: "pfm", magic: "PF",
        lsb: "00000000000000000000803f0000803f0000803f0000803f8180003f8180803e8180003e000000000000803f00000000",
        msb: "00000000000000003f8000003f8000003f8000003f8000003f0080813e8080813e008081000000003f80000000000000"
    },
    {
        format: "phm", magic: "PH",
        lsb: "00000000003c003c003c003c0438043404300000003c0000",
        msb: "000000003c003c003c003c0038043404300400003c000000"
    }
];

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const fixture of fixtures)
for (const endian of ["LSB", "MSB"] as const)
for (const destination of ["-", "/sheet.bin"] as const) {
    it(`${mode} writes native ${endian} montage ${fixture.format} to ${destination}`, async () => {
        const args = ["xc:#804020", "xc:lime", "xc:blue", "xc:white", "-tile", "2x2", "-geometry", "+0+0", "-endian", endian, `${fixture.format}:${destination}`];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        let output: Uint8Array;
        if (mode === "magick" || mode === "montage") {
            const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
            const chunks: Uint8Array[] = [], stderr: Uint8Array[] = [];
            const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr.push(chunk.slice()); } }
            });
            expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
            output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
        } else {
            const result = mode === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            output = destination === "-" ? result.stdoutBytes!
                : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
        }
        const header = Buffer.from(`${fixture.magic}\n2 2\n${endian === "LSB" ? "-1.0" : "1.0"}\n`);
        expect(Buffer.from(output.subarray(0, header.length))).toEqual(header);
        expect(Buffer.from(output.subarray(header.length)).toString("hex")).toBe(endian === "LSB" ? fixture.lsb : fixture.msb);
    });
}
