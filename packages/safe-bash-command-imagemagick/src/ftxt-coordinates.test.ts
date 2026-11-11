import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const operand of ["ftxt:/pixels.dat", "ftxt:-"]) it.each([
        { size: "2x1", options: [], records: "0,0:65535,0,0\n1,0:0,0,65535\n", expected: "ff0000ff0000ffff" },
        { size: "2x1", options: [], records: "1,0:0,0,65535\n0,0:65535,0,0\n", expected: "ff0000ff0000ffff" },
        { size: "2x2", options: [], records: "1,1:65535,65535,65535\n0,0:65535,0,0\n0,1:0,0,65535\n1,0:0,65535,0", expected: ["ff0000ff", "00ff00ff", "0000ffff", "ffffffff"].join("") },
        { size: "2x1", options: ["-define", "ftxt:format=\\y/\\x=\\c\\n", "-define", "ftxt:hasalpha=true"], records: "0/1=0,0,65535,65535\n0/0=65535,0,0,32896\n", expected: "ff0000800000ffff" },
        { size: "2x1", options: ["-define", "ftxt:format=\\c\\n"], records: "65535,0,0\n0,0,65535\n", expected: "ff0000ff0000ffff" },
    ])(`places FTXT records by coordinates (${mode}, ${operand}): $size $records`, async ({ size, options, records, expected }) => {
        const input = new TextEncoder().encode(records), files = new Map([["/pixels.dat", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/pixels.dat", input);
        const args = ["-size", size, ...options, operand, "-depth", "8", "rgba:-"];
        if (mode === "command") {
            const output: Uint8Array[] = [], errors: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () { yield input; })(), signal: new AbortController().signal,
                stdout: { async write(bytes) { output.push(bytes.slice()); } },
                stderr: { async write(bytes) { errors.push(bytes.slice()); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(errors).toString()).toBe("");
            expect(Buffer.concat(output).toString("hex")).toBe(expected);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files, input) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files, input);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
        }
    });
}
