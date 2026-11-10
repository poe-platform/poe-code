import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const alphaToRed = "0 0 0 0 1 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1";
const identity = "1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1";
const ppm = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("123456ab674580a0e0", "hex")]);
const pam = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("12345678ab6745ff80a0e000", "hex")
]);

// Exit status and raw RGBA bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Disassociate", matrix: "1", expected: "00" },
        { alpha: "Disassociate", matrix: "0 1 0 0 0 1 1 0 0", expected: "00" },
        { alpha: "Disassociate", matrix: undefined, expected: "60" },
        { alpha: "Discrete", matrix: "1", expected: "60" }
    ])(`${mode}: separates $alpha alpha after matrix $matrix`, async ({ alpha, matrix, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#80502060", "-alpha", alpha,
            ...(matrix === undefined ? [] : ["-color-matrix", matrix]),
            "-channel", "A", "-separate", "+channel", "-depth", "8", "gray:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });

    it.each([
        { name: "absent alpha contributes zero", input: ppm, filename: "pic.ppm", matrix: alphaToRed, expected: "003456ff006745ff00a0e0ff" },
        { name: "identity preserves opaque RGB", input: ppm, filename: "pic.ppm", matrix: identity, expected: "123456ffab6745ff80a0e0ff" },
        { name: "present alpha contributes its sample", input: pam, filename: "pic.pam", matrix: alphaToRed, expected: "78345678ff6745ff00a0e000" }
    ])(`${mode}: $name in a color matrix`, async ({ input, filename, matrix, expected }) => {
        const files = new Map<string, Uint8Array>([[`/${filename}`, input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = [`/${filename}`, "-color-matrix", matrix, "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
