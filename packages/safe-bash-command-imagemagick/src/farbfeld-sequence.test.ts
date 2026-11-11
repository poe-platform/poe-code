import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Independent RGBA16 records retain transparent color and non-byte-aligned samples.
const first = Buffer.from("6661726266656c6400000002000000011234abcd8001000080011235cdef8000", "hex");
const second = Buffer.from("6661726266656c64000000020000000180011235cdef80001234abcd80010000", "hex");
const keep = Buffer.from("KEEP");

for (const mode of ["buffered", "sync", "stored", "command"] as const) {
    for (const write of ["output", "-write", "+write"]) {
        for (const [name, options, target, paths] of [
            ["default", [], "/out.ff", ["/out-0.ff", "/out-1.ff"]],
            ["scene", ["-scene", "7"], "/out.ff", ["/out-7.ff", "/out-8.ff"]],
            ["explicit adjoin", ["-adjoin"], "/out.ff", ["/out-0.ff", "/out-1.ff"]],
            ["split", ["+adjoin"], "/out.ff", ["/out-0.ff", "/out-1.ff"]],
            ["pattern", [], "/out-%02d.ff", ["/out-00.ff", "/out-01.ff"]],
            ["coder", [], "FARBFELD:/out.bin", ["/out-0.bin", "/out-1.bin"]],
            ["stdout", [], "FF:-", []],
            ["split stdout", ["+adjoin"], "FF:-", []],
        ] as const) {
            it(`${mode} ${write} ${name} preserves both farbfeld frames and the literal destination`, async () => {
                const files = new Map<string, Uint8Array>([["/in.ff", first], ["/out.ff", keep], ["/out.bin", keep]]);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const args = ["/in.ff", "(", "/in.ff", "-flop", ")", ...options, ...(write === "output" ? [target] : [write, target, "null:"])];
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const read = async (path: string) => mode === "stored" || mode === "command" ? await fs.readFile(path) : files.get(path)!;
                expect(Buffer.from(await read("/out.ff"))).toEqual(keep);
                expect(Buffer.from(await read("/out.bin"))).toEqual(keep);
                if (paths.length) {
                    expect(Buffer.from(await read(paths[0]))).toEqual(first);
                    expect(Buffer.from(await read(paths[1]))).toEqual(second);
                } else {
                    const bytes = mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
                    expect(bytes).toBeDefined();
                    expect(Buffer.from(bytes!)).toEqual(Buffer.concat([first, second]));
                    expect(mode === "stored" || mode === "command" ? (await fs.readdir("/")).some(entry => entry.name === "--0") : files.has("--0")).toBe(false);
                }
            });
        }
    }
}
