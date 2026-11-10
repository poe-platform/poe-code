import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = spawnSync("magick", ["-size", "2x1", "-depth", "8", "rgba:-", "PNG32:-"], { input: Buffer.from("12345680abcdef40", "hex") }).stdout;
const cases = { rgb: "123456abcdef", rgba: "12345680abcdef40", bgr: "563412efcdab", gray: "2fc8", graya: "2f80c840" };
for (const [coder, hex] of Object.entries(cases)) {
    it(`${coder}: agrees with native raw bytes`, () => {
        const native = spawnSync("magick", ["png:-", `${coder}:-`], { input });
        expect(native.status).toBe(0);
        expect(native.stdout.toString("hex")).toBe(hex);
    });
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each([`out.${coder}`, `${coder.toUpperCase()}:out.bin`, `${coder}:-`])(`${mode}: writes ${coder} bytes to %s`, async target => {
            const fs = new MemoryFileSystem(), files = new Map([["in.png", new Uint8Array(input)]]);
            await fs.writeFile("/in.png", input);
            const args = ["in.png", target];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const path = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
            const bytes = path === "-" ? result.stdoutBytes : mode === "retained" ? await fs.readFile("/" + path) : files.get(path);
            expect(Buffer.from(bytes!).toString("hex")).toBe(hex);
            expect(mode === "retained" ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].sort()).toEqual(path === "-" ? ["in.png"] : ["in.png", path].sort());
        });
        it(`${mode}: supports intermediate ${coder} writes`, async () => {
            const fs = new MemoryFileSystem(), files = new Map([["in.png", new Uint8Array(input)]]);
            await fs.writeFile("/in.png", input);
            const args = ["in.png", "-write", `${coder}:out.bin`, "null:"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(Buffer.from(mode === "retained" ? await fs.readFile("/out.bin") : files.get("out.bin")!).toString("hex")).toBe(hex);
        });
    }
}
it("streams raw bytes through the command stdout", async () => {
    const fs = new MemoryFileSystem(); await fs.writeFile("/in.png", input);
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["in.png", "rgba:-"]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes); } }
    });
    expect(Buffer.concat(errors).toString()).toBe(""); expect(result.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString("hex")).toBe(cases.rgba);
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["rgb", "rgba", "bgr", "gray", "graya"])(`${mode}: preserves 16-bit %s samples`, async coder => {
        const png = spawnSync("magick", ["-size", "1x1", "-depth", "16", "-endian", "MSB", "rgba:-", "PNG64:-"], { input: Buffer.from("123456789abcdef0", "hex") }).stdout;
        const expected = spawnSync("magick", ["png:-", `${coder}:-`], { input: png }).stdout;
        const files = new Map([["in.png", new Uint8Array(png)]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", png);
        const args = ["in.png", `${coder}:-`];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(result.stdoutBytes!)).toEqual(expected);
    });
}
