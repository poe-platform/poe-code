import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: plus is deprecated; minus renders these gray samples.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { options: ["+range-threshold", "10x30+60+90%"], argument: 2 },
        { options: ["+range-threshold"], argument: 2 },
        { options: ["-depth", "8", "+range-threshold", "10x30+60+90%"], argument: 4 },
        { options: ["(", "-depth", "8", "+range-threshold", "10x30+60+90%", ")"], argument: 5 },
        { options: ["-range-threshold", "10x30+60+90%"], argument: 0 },
    ])(`${mode}: reports native range-threshold status for $options`, async ({ options, argument }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([
            ["/in.pgm", Buffer.concat([Buffer.from("P5\n9 1\n255\n"), Buffer.from([0, 32, 64, 96, 128, 160, 192, 224, 255])])],
            ["/out.gray", original],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pgm", ...options, "-endian", "MSB", "-depth", "16", "gray:/out.gray"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(argument ? 1 : 0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(argument ? `magick: option deprecated, unable to execute '+range-threshold' at CLI arg ${argument}\n` : "");
        const output = mode === "sync" || mode === "buffered" ? files.get("/out.gray")! : await fs.readFile("/out.gray");
        expect(Buffer.from(output).toString("hex")).toBe(argument ? Buffer.from(original).toString("hex") : "000020a1c141ffffffffe8927d7d12680000");
    });
}

it("emits no image bytes to stdout for the deprecated plus form", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pgm", Buffer.concat([Buffer.from("P5\n9 1\n255\n"), Buffer.from([0, 32, 64, 96, 128, 160, 192, 224, 255])]));
    const argumentValues = createCommandArguments(["/in.pgm", "+range-threshold", "10x30+60+90%", "-endian", "MSB", "-depth", "16", "gray:-"]);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(1);
    expect(Buffer.concat(stdout)).toHaveLength(0);
    expect(stderr).toBe("magick: option deprecated, unable to execute '+range-threshold' at CLI arg 2\n");
});
