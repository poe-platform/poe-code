import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 exports.
const cases = [
    { coder: "cmyk", depth: 8, input: "093e73a8dd12477cb1e61b5085baef24", output: "544230ff117a5fff36119cff693b0eff", exitCode: 0 },
    { coder: "cmyk", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc01366ba0d50a3f74", output: "632d79ff15963bff17011fff6e3485ff", exitCode: 0 },
    { coder: "cmyka", depth: 8, input: "093e73a8dd12477cb1e61b5085baef24598ec3f8", output: "544230dd483828e63e2f21ef34271bf8", exitCode: 0 },
    { coder: "cmyka", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc01366ba0d50a3f74a9de13487db2e71c", output: "632d79e64e1f61f83a134b0b2a0a371d", exitCode: 0 },
    { coder: "rgb", depth: 8, input: "093e73a8dd12477cb1e61b50", output: "093e73ffa8dd12ff477cb1ffe61b50ff", exitCode: 0 },
    { coder: "cmyk", depth: 8, input: "093e73a8dd12477c", output: "4b454550", exitCode: 1 },
    { coder: "cmyka", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f8", output: "4b454550", exitCode: 1 }
];

for (const mode of ["file", "extension", "stream", "sync"] as const) for (const endian of ["LSB", "MSB"]) {
    it.each(cases)(`${mode} ${endian} decodes $coder at depth $depth: $input`, async ({ coder, depth, input, output, exitCode }) => {
        const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP");
        if (depth === 16 && endian === "MSB") bytes.swap16();
        const path = `/raw.${coder}`;
        const argv = ["-size", "2x2", "-depth", String(depth), "-endian", endian, mode === "extension" ? path : `${coder}:${mode === "stream" ? "-" : path}`, "-append", "-depth", "8", "rgba:/out"];
        let result: { exitCode: number }, stderr: string, actual: Uint8Array;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([[path, bytes], ["/out", keep]]);
            const sync = runMagickCliSync(argv, files);
            result = sync;
            stderr = sync.stderr;
            actual = files.get("/out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile(path, bytes);
            await fs.writeFile("/out", keep);
            const args = createCommandArguments(argv);
            stderr = "";
            result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            actual = await fs.readFile("/out");
        }
        expect(result.exitCode).toBe(exitCode);
        expect(Buffer.from(actual).toString("hex")).toBe(output);
        if (exitCode) expect(stderr).toContain(`unexpected end-of-file in ${coder.toUpperCase()} input`);
        else expect(stderr).toBe("");
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each(cases.filter(test => test.depth === 16 && test.exitCode === 0))(`${mode} retains $coder inks across bounded reads, byte offsets and frame selection`, async ({ coder, input }) => {
        const pixels = Buffer.from(input.repeat(257), "hex");
        const bytes = Buffer.concat([Buffer.from("PAD"), Buffer.alloc(pixels.length), pixels]);
        const files = new Map<string, Uint8Array>([["/in", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", bytes);
        const args = ["-size", "257x4+3", "-depth", "16", `${coder}:/in[1]`, `${coder}:/out`];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out"))).toEqual(pixels);
    });

    it.each(["cmyk", "cmyka"])(`${mode} requires dimensions for %s and preserves the destination`, async coder => {
        const keep = new TextEncoder().encode("KEEP"), files = new Map<string, Uint8Array>([["/in", new Uint8Array(20)], ["/out", keep]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["-depth", "8", `${coder}:/in`, "rgba:/out"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("must specify image size");
        expect(mode === "sync" ? files.get("/out") : await filesystem.readFile("/out")).toEqual(keep);
    });
}
