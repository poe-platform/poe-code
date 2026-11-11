import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Independent farbfeld fixture: transparent RGB and half-alpha retain all 16 bits.
const payload = "1234abcd8001000080011235cdef8000";
const bytes = Buffer.from("6661726266656c640000000200000001" + payload, "hex");
for (const mode of ["sync", "buffered", "file"] as const) {
    for (const [input, format] of [["/input.ff", "FF"], ["FF:/colors.bin", "FF"], ["FARBFELD:/colors.bin", "FARBFELD"], ["farbfeld:/colors.bin", "FARBFELD"]] as const) {
        it(`${mode} decodes ${input} losslessly`, async () => {
            const path = input.includes(":") ? "/colors.bin" : input;
            const files = new Map<string, Uint8Array>([[path, bytes]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile(path, bytes);
            const args = [input, "-format", "%m|%[magick]", "-write", "info:", "-depth", "16", "-endian", "MSB", "rgba:/out"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "file" ? { filesystem, cwd: "/" } : files);
            expect(result.stdout).toBe(`${format}|${format}`);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(mode === "file" ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(payload);
        });
    }
}

for (const [input, format] of [["-", "FF"], ["FF:-", "FF"], ["FARBFELD:-", "FARBFELD"]] as const) {
    it(`reports ${format} and decodes ${input} without losing transparent RGB`, async () => {
        const filesystem = new MemoryFileSystem();
        const args = createCommandArguments([input, "-format", "%m|%[magick]", "-write", "info:", "-depth", "16", "-endian", "MSB", "rgba:/out"]);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect(stdout).toBe(`${format}|${format}`);
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(await filesystem.readFile("/out")).toString("hex")).toBe(payload);
    });
}

for (const [input, format] of [["in.ff", "FF"], ["FF:in.ff", "FF"], ["FARBFELD:in.ff", "FARBFELD"]] as const) {
    it(`magick ${input} reports the input coder in both format properties`, async () => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ff", bytes);
        const args = createCommandArguments([input, "-format", "%m|%[magick]", "info:"]);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: `${format}|${format}`, stderr: "" });
    });
}
