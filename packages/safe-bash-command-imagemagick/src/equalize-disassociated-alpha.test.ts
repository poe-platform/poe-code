import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) {
        it.each([
            { name: "disassociated one-pixel histogram", input: ["xc:#12345680"], operations: ["-alpha", "Disassociate", "-equalize"], expected: "0000ffff" },
            { name: "disassociated two-pixel histogram", input: ["xc:#12345680", "xc:#94ced340", "+append"], operations: ["-alpha", "Disassociate", "-equalize"], expected: "000080ff808080ff" },
            { name: "independent RGB channels", input: ["xc:#12345680"], operations: ["-alpha", "Disassociate", "-channel", "RGB", "-equalize", "+channel"], expected: "0000ffff" },
            { name: "selected red channel", input: ["xc:#12345680"], operations: ["-alpha", "Disassociate", "-channel", "R", "-equalize", "+channel"], expected: "0068abff" },
            { name: "reactivated alpha", input: ["xc:#12345680"], operations: ["-alpha", "Disassociate", "-equalize", "-alpha", "activate"], expected: "0000ff00" },
            { name: "gray histogram", input: ["xc:#12345680", "-colorspace", "Gray"], operations: ["-alpha", "Disassociate", "-equalize"], expected: "000000ff" },
            { name: "CMYK histogram", input: ["xc:#12345680", "-colorspace", "CMYK"], operations: ["-alpha", "Disassociate", "-equalize"], expected: "ffffffff" },
            { name: "disassociation alone", input: ["xc:#12345680"], operations: ["-alpha", "Disassociate"], expected: "2468abff" },
            { name: "alpha off", input: ["xc:#12345680"], operations: ["-alpha", "off", "-equalize"], expected: "00ffffff" },
            { name: "active alpha", input: ["xc:#12345680"], operations: ["-equalize"], expected: "00ffffff" },
        ])(`${mode} ${format}: $name`, async ({ input, operations, expected }) => {
            const argv = [...input, ...operations, "-depth", "8", `${format}:${mode === "command" ? "-" : "/out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "rgba" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
        });
    }
}
