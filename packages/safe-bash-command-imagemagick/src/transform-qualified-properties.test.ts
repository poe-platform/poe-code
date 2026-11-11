import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI output for a labeled 4x3 RGB image.
const cases = [
    { operation: "-roll", geometry: "+2-1", hex: "8b9299a0a7ae61686f767d84dfe6edf4fb02b5bcc3cad1d8373e454c535a0d141b222930" },
    { operation: "-chop", geometry: "1x1+1+0", hex: "61686f8b9299a0a7aeb5bcc3dfe6edf4fb02" },
    { operation: "-shave", geometry: "1x1", hex: "767d848b9299" },
    { operation: "-splice", geometry: "1x1+1+0", hex: "ffffffffffffffffffffffffffffff0d141bffffff222930373e454c535a61686fffffff767d848b9299a0a7aeb5bcc3ffffffcad1d8dfe6edf4fb02" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const namespace of ["option", "artifact", "unqualified"] as const) {
        it.each(cases)(`resolves ${namespace} geometry for $operation (${mode})`, async ({ operation, geometry, hex }) => {
            const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from({ length: 36 }, (_, i) => (13 + 7 * i) % 256)]);
            const files = new Map([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const setting = namespace === "artifact" ? ["-define", `shift=${geometry}`] : ["-set", "option:shift", geometry];
            const reference = namespace === "unqualified" ? "%[shift]" : `%[${namespace}:shift]`;
            // Later settings must not change the value captured by the operation.
            const argv = ["/in.ppm", ...setting, operation, reference, "-set", "option:shift", "0x0", "-depth", "8", "rgb:-"];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(output).toString("hex")).toBe(hex);
        });
    }
}
