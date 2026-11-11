import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const operand of ["ftxt:/pixels.dat", "ftxt:-"]) it.each([
        { records: "0,0:100%,0%,0%\n1,0:0%,0%,100%\n", absolute: "0,0:65535,0,0\n1,0:0,0,65535\n", expected: "ff0000ff0000ffff" },
        { records: "0,0:50%,16384,75%\n1,0:12.5%,0,100%", absolute: "0,0:32768,16384,49151\n1,0:8192,0,65535", expected: "8040bfff2000ffff" },
    ])(`decodes percentage and absolute FTXT samples identically (${mode}, ${operand}): $records`, async ({ records, absolute, expected }) => {
        for (const text of [absolute, records]) {
            const input = new TextEncoder().encode(text), files = new Map([["/pixels.dat", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/pixels.dat", input);
            const args = ["-size", "2x1", operand, "-depth", "8", "rgba:-"];
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
        }
    });
}
