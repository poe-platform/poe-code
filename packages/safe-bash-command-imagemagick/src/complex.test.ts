import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"])
for (const operation of ["Add", "Subtract"])
it(`${mode}: complex ${operation} writes real then imaginary`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["-size", "1x1", "xc:#330000", "xc:#003300", "xc:#110000", "xc:#001100",
        "-complex", operation, "+adjoin", "PNG24:/n-%d.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const value = operation === "Add" ? 0x44 : 0x22;
    for (const [index, expected] of [[value, 0, 0, 255], [0, value, 0, 255]].entries()) {
        const path = `/n-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect([...output.data]).toEqual(expected);
    }
});

for (const retained of [false, true]) {
    it(`complex arithmetic preserves negative intermediate samples (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1x1", "xc:#110000", "xc:#001100", "xc:#330000", "xc:#003300",
            "-complex", "Subtract", "xc:#330000", "xc:#003300", "-complex", "Add", "+adjoin", "PNG24:/n-%d.png"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const [index, expected] of [[17, 0, 0, 255], [0, 17, 0, 255]].entries()) {
            const path = `/n-${index}.png`;
            expect([...decodeImage(retained ? await fs.readFile(path) : files.get(path)!).data]).toEqual(expected);
        }
    });

    it(`complex uses the first pair again when no second pair exists (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1x1", "xc:#330000", "xc:#003300", "-complex", "Add", "+adjoin", "PNG24:/n-%d.png"],
            retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const [index, expected] of [[102, 0, 0, 255], [0, 102, 0, 255]].entries()) {
            const path = `/n-${index}.png`;
            expect([...decodeImage(retained ? await fs.readFile(path) : files.get(path)!).data]).toEqual(expected);
        }
    });

    for (const [args, error] of [
        [["xc:red", "-complex", "Add"], "image sequence is required"],
        [["xc:red", "xc:green", "-complex", "Bogus"], "unsupported complex operator"],
        [["xc:red", "xc:green", "-complex"], "missing argument"],
    ] as const)
    it(`complex rejects ${error} (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli([...args, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        if (retained) await expect(fs.readFile("/out.png")).rejects.toThrow();
        else expect(files.has("/out.png")).toBe(false);
    });
}
