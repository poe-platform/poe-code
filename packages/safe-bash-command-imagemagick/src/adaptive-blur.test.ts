import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * i * 7 + 17 * i + 23) % 256))]);
// Binary PPM digests from ImageMagick 7.1.2-35 Q16-HDRI, distinct from ordinary blur.
const cases = [
    { geometry: "1x1", digest: "a13a61a8c45399fbb3c43e8f7a34c331578a2c525c59a7516e72fd911e856ee7" },
    { geometry: "0x1", digest: "0dde257147e2fec6858250ff305d7983a5c182da7a4a7689db7e1a19754df129" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each(cases)(`matches native adaptive blur $geometry (${mode})`, async ({ geometry, digest }) => {
    const files = new Map([["/image.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/image.ppm", input);
    const args = ["/image.ppm", "-adaptive-blur", geometry, "-depth", "8", mode === "command" ? "ppm:-" : "ppm:/out.ppm"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O is forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } }),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks) : mode === "retained" ? await fs.readFile("/out.ppm") : files.get("/out.ppm")!;
    expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
});

for (const mode of ["sync", "retained"] as const) {
    it.each(["bad", "", "2x1junk", "5000x1"])(`rejects invalid adaptive blur without replacing output (${mode}, %j)`, async geometry => {
        const previous = new TextEncoder().encode("keep this output");
        const files = new Map<string, Uint8Array>([["/image.ppm", input], ["/out.ppm", previous]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const args = ["/image.ppm", "-adaptive-blur", geometry, "ppm:/out.ppm"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).not.toBe(0);
        expect(mode === "sync" ? files.get("/out.ppm") : await fs.readFile("/out.ppm")).toEqual(previous);
    });

    it(`expands adaptive blur properties and preserves pixels for zero sigma (${mode})`, async () => {
        const files = new Map([["/image.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/image.ppm", input);
        const args = ["/image.ppm", "-set", "option:blur", "2x0", "-adaptive-blur", "%[blur]", "-depth", "8", "ppm:/out.ppm"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(mode === "sync" ? files.get("/out.ppm")! : await fs.readFile("/out.ppm"))).toEqual(input);
    });
}

for (const mode of ["sync", "retained"] as const)
it.each([
    ["1x1", "41a25a753f1553c6425462727ac9a09c030f467b91b1e4b160218cf6182078b99bae7a312e3c83c951ae7b4d68be5fab"],
    ["0x1", "42ee637146b162e7425462727ac9a09c1a2c52b58aa3be44617a8525213373ec74b579293f537d544c8f726f671d6feb"],
])(`matches native 16-bit adaptive blur with alpha (${mode}, %s)`, async (geometry, expected) => {
    const pixels = Buffer.alloc(48);
    for (let i = 0; i < 24; i++) pixels.writeUInt16BE((i * i * 997 + 311 * i + 23) % 65536, i * 2);
    const pam = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels]);
    const files = new Map([["/image.pam", pam]]), fs = new MemoryFileSystem();
    await fs.writeFile("/image.pam", pam);
    const args = ["/image.pam", "-adaptive-blur", geometry, "-depth", "16", "-endian", "MSB", "rgba:/out.rgba"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "sync" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba")).toString("hex")).toBe(expected);
});
