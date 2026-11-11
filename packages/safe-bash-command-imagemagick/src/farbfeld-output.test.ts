import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const payload = "1234abcd8001000080011235cdef8000";
const expected = "6661726266656c640000000200000001" + payload;

for (const mode of ["buffered", "sync", "command"] as const) {
    for (const target of ["/out.ff", "/out.farbfeld", "FF:/out.bin", "farbfeld:/out.bin", "FF:-"] as const) {
        for (const write of [false, true]) {
            it(`${mode} ${write ? "-write" : "output"} ${target} preserves RGBA16 bytes`, async () => {
                const files = new Map<string, Uint8Array>([["/in.raw", Buffer.from(payload, "hex")]]);
                const args = ["-size", "2x1", "-depth", "16", "-endian", "MSB", "rgba:/in.raw", ...(write ? ["-write", target, "null:"] : [target])];
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.raw", files.get("/in.raw")!);
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const path = target.slice(target.indexOf(":") + 1);
                const bytes = path === "-" ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result ? result.stdoutBytes : undefined
                    : mode === "command" ? await fs.readFile(path) : files.get(path);
                expect(bytes).toBeDefined();
                expect(Buffer.from(bytes!).toString("hex")).toBe(expected);
                if (target.includes(":")) expect(files.has(target)).toBe(false);
            });
        }
    }
}

it("always writes big-endian 16-bit RGBA from 8-bit RGB input", async () => {
    const files = new Map<string, Uint8Array>([["in.raw", Uint8Array.of(0x12, 0xab, 0x80)]]);
    const result = await runConvertCli(["-size", "1x1", "-depth", "8", "-endian", "LSB", "rgb:in.raw", "-interlace", "Plane", "out.ff"], files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(files.get("out.ff")!).toString("hex")).toBe("6661726266656c6400000001000000011212abab8080ffff");
});
