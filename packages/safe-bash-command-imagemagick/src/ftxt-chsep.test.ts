import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "command"] as const) {
    for (const operation of ["read", "write"]) it.each([
        { options: [], separator: "," },
        { options: ["-define", "ftxt:chsep=;"], separator: ";" },
        { options: ["-define", "ftxt:chsep=|"], separator: "|" },
        { options: ["-define", "ftxt:chsep=="], separator: "=" },
        { options: ["-define", "ftxt:chsep=X"], separator: "X" },
        { options: ["-define", "ftxt:chsep=;ignored"], separator: ";" },
        { options: ["-define", "ftxt:chsep=;", "+define", "ftxt:chsep"], separator: "," },
    ])(`${mode}: ${operation} FTXT with $options`, async ({ options, separator }) => {
        const ppm = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
        const input = Buffer.from(`0,0:${[65535, 0, 0].join(separator)}\n1,0:${[0, 0, 65535].join(separator)}\n`);
        const files = new Map([["/in.ppm", ppm], ["/pixels.dat", input]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const cases = [
            { args: ["/in.ppm", ...options, "ftxt:-"], expected: `0,0:${[2570, 5140, 7710].join(separator)}\n1,0:${[23130, 28270, 33410].join(separator)}\n` },
            { args: ["/in.ppm", ...options, "-define", "ftxt:format=\\x/\\y=\\c\\n", "ftxt:/out.dat"], expected: `0/0=${[2570, 5140, 7710].join(separator)}\n1/0=${[23130, 28270, 33410].join(separator)}\n` },
            { args: ["-size", "2x1", ...options, "ftxt:/pixels.dat", "-depth", "8", "rgba:/out"] },
            { args: ["-size", "2x1", ...options, "ftxt:-", "-depth", "8", "rgba:/out"] },
        ];
        for (const { args, expected } of operation === "write" ? cases.slice(0, 2) : cases.slice(2)) {
            let stdout: string;
            if (mode === "command") {
                const output: Uint8Array[] = [], errors: Uint8Array[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args,
                    cwd: "/", env: {}, fs, stdin: (async function* () { yield input; })(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { output.push(bytes.slice()); } },
                    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(errors).toString()).toBe("");
                stdout = Buffer.concat(output).toString();
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files, input) : await runConvertCli(args, files, input);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                stdout = result.stdout;
            }
            const target = args.at(-1)!;
            if (target === "ftxt:-") expect(stdout).toBe(expected);
            else {
                expect(stdout).toBe("");
                const path = target.slice(target.indexOf(":") + 1);
                const bytes = mode === "command" ? await fs.readFile(path) : files.get(path)!;
                expect(Buffer.from(bytes).toString(expected === undefined ? "hex" : "utf8")).toBe(expected ?? "ff0000ff0000ffff");
            }
        }
    });
}
