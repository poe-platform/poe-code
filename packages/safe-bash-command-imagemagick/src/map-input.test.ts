import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command", "stdin"] as const) {
    for (const name of ["/swatch.map", "MAP:/swatch.bin"]) {
        it(`reads hand-built MAP palette and indices (${mode}, ${name})`, async () => {
            const input = Uint8Array.from([255, 0, 0, 0, 0, 255, 0, 1, 0]);
            const path = name.startsWith("MAP:") ? name.slice(4) : name;
            const files = new Map([[path, input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile(path, input);
            const argv = ["-size", "3x1+2", "-depth", "8", mode === "stdin" ? "MAP:-" : name, "rgb:/out"];
            if (mode === "command" || mode === "stdin") {
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () { yield input; })(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            } else {
                expect(mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" }))
                    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            }
            const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await filesystem.readFile("/out");
            expect([...output]).toEqual([255, 0, 0, 0, 0, 255, 255, 0, 0]);
        });
    }
}
for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`rejects invalid MAP without replacing output (${mode})`, async () => {
        for (const input of [Uint8Array.of(255), Uint8Array.of(255, 0, 0, 0, 0, 255, 0, 1), Uint8Array.of(255, 0, 0, 0, 0, 255, 0, 2, 0)]) {
            const files = new Map([["/in.map", input], ["/out", Uint8Array.of(42)]]), filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const argv = ["-size", "3x1+2", "-depth", "8", "/in.map", "rgb:/out"];
            const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect([...mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!]).toEqual([42]);
        }
    });
    for (const colors of [2, 256, 257]) {
        it(`reads 16-bit palette, row padding and wide indices (${mode}, ${colors} colors)`, async () => {
            const input = new Uint8Array(colors * 6 + 8);
            input.set([0x12, 0x34, 0x45, 0x67, 0x89, 0xab]);
            input.set([0xab, 0xcd, 0x13, 0x79, 0x24, 0x68], (colors - 1) * 6);
            input.set(colors > 256 ? [0, 0, 1, 0, 1, 0, 0, 0] : [0, colors - 1, 255, 255, colors - 1, 0, 255, 255], colors * 6);
            const files = new Map([["/in.map", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.map", input);
            const argv = ["-size", colors === 256 ? "2x2" : `2x2+${colors}`, "-depth", "16", "-endian", "LSB", "/in.map", "-endian", "MSB", "rgb:/out"];
            const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe("1234456789ababcd13792468abcd137924681234456789ab");
        });
    }
}

it.each(["2x1", "2x1+0"])("defaults to 256 palette entries for %s", size => {
    const input = new Uint8Array(256 * 3 + 2);
    input.set([255, 0, 0]);
    input.set([0, 0, 255], 255 * 3);
    input.set([255, 0], 256 * 3);
    const files = new Map([["in.map", input]]);
    expect(runConvertCliSync(["-size", size, "-depth", "8", "in.map", "rgb:out"], files).exitCode).toBe(0);
    expect([...files.get("out")!]).toEqual([0, 0, 255, 255, 0, 0]);
});

it.each([
    { options: ["-depth", "8"], error: "must specify image size" },
    { options: ["-size", "1x1+257", "-depth", "8"], error: "invalid MAP palette size" },
    { options: ["-size", "1x1+2", "-depth", "32"], error: "unsupported MAP input depth" }
])("rejects invalid MAP settings: $options", ({ options, error }) => {
    const files = new Map([["in.map", Uint8Array.of(255, 0, 0, 0, 0, 255, 0)]]);
    const result = runConvertCliSync([...options, "in.map", "rgb:out"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(error);
    expect(files.has("out")).toBe(false);
});
