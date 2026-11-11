import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Independent farbfeld fixture: transparent RGB and half-alpha retain all 16 bits.
const payload = "1234abcd8001000080011235cdef8000";
const bytes = Buffer.from("6661726266656c640000000200000001" + payload, "hex");
for (const mode of ["sync", "buffered", "file"] as const) {
    for (const input of ["/input.ff", "FARBFELD:/colors.bin"]) {
        it(`${mode} decodes ${input} losslessly`, async () => {
            const path = input.includes(":") ? "/colors.bin" : input;
            const files = new Map<string, Uint8Array>([[path, bytes]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile(path, bytes);
            const args = [input, "-depth", "16", "-endian", "MSB", "rgba:/out"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "file" ? { filesystem, cwd: "/" } : files);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(mode === "file" ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(payload);
        });
    }
}

it("decodes prefixed stdin without losing transparent RGB", async () => {
    const filesystem = new MemoryFileSystem();
    const args = createCommandArguments(["FARBFELD:-", "-depth", "16", "-endian", "MSB", "rgba:/out"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal,
        stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(await filesystem.readFile("/out")).toString("hex")).toBe(payload);
});
