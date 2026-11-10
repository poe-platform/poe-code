import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, packed samples in row-major order.
const input8 = "093e73a8dd12477cb1e61b5085baef24";
const input16 = input8 + "598ec3f82d6297cc01366ba0d50a3f74";
const cases = [
    { coder: "rgba", depth: "8", input: input8, output: input8 },
    { coder: "rgba", depth: "16", input: input16, output: "3ea8137ce650ba258ef862cc36a00b74" },
    { coder: "rgbo", depth: "8", input: input8, output: "093e7357dd124783b1e61baf85baefdb" },
    { coder: "rgbo", depth: "16", input: input16, output: "3ea81383e650bada8ef8623336a00b8b" },
    { coder: "rgb", depth: "8", input: "093e73a8dd12477cb1e61b50", output: "093e73ffa8dd12ff477cb1ffe61b50ff" }
];

for (const mode of ["file", "stream", "sync"] as const) {
    async function run(options: string[], coder: string, input: string) {
        const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP");
        const argv = [...options, `${coder}:${mode === "stream" ? "-" : "/raw.bin"}`, "-append", "-depth", "8", "rgba:/out"];
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/raw.bin", bytes], ["/out", keep]]);
            const result = runMagickCliSync(argv, files);
            return { ...result, output: Buffer.from(files.get("/out")!).toString("hex") };
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/raw.bin", bytes);
        await fs.writeFile("/out", keep);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        return { ...result, stderr, output: Buffer.from(await fs.readFile("/out")).toString("hex") };
    }

    it.each(cases)(`${mode} decodes $coder at depth $depth`, async ({ coder, depth, input, output }) => {
        const result = await run(["-size", "2x2", "-depth", depth], coder, input);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe(output);
    });

    it.each(cases.filter(test => test.depth === "16"))(`${mode} decodes MSB $coder`, async ({ coder, input, output }) => {
        const result = await run(["-size", "2x2", "-depth", "16", "-endian", "MSB"], coder, Buffer.from(input, "hex").swap16().toString("hex"));
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe(output);
    });

    it.each(cases.filter(test => test.depth === "16"))(`${mode} decodes $coder across bounded reads`, async ({ coder, input, output }) => {
        const result = await run(["-size", "2x602", "-depth", "16"], coder, input.repeat(301));
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe(output.repeat(301));
    });

    for (const coder of ["rgba", "rgbo"]) {
        it.each([
            { options: ["-depth", "8"], input: input8, error: "must specify image size" },
            { options: ["-size", "2x2", "-depth", "8"], input: input8.slice(0, -2), error: "unexpected end-of-file" },
            { options: ["-size", "2x2", "-depth", "16"], input: input16.slice(0, -2), error: "unexpected end-of-file" }
        ])(`${mode} preserves output for invalid ${coder}: $options $error`, async ({ options, input, error }) => {
            const result = await run(options, coder, input);
            expect(result.exitCode).toBe(1);
            expect(result.output).toBe("4b454550");
            expect(result.stderr).toContain(error);
        });
    }
}
