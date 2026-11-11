import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Pixel output and warnings verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "stream", "buffered", "sync"] as const)
for (const test of [
    { operations: ["-crop", "2x1+1+0", "+repage", "-crop", "1x1+0+0"], pixel: "ff0000" },
    { operations: ["-repage", "4x2+1+0", "-crop", "1x1+1+0"], pixel: "ff0000" },
    { operations: ["-repage", "4x2+1+0", "-crop", "1x1+0+0"], pixel: "ffffff", warning: true },
    { operations: ["-repage", "4x2+1+0", "+repage", "-crop", "1x1+0+0"], pixel: "ff0000" },
    { operations: ["-crop", "1x1+0+0"], pixel: "ff0000" }
]) {
    it(`${mode}: applies montage page operations in order: ${test.operations.join(" ")}`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "3x2", "xc:red", ...test.operations, "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
        let stderr = "", bytes: Uint8Array | undefined, exitCode: number;
        const sink = { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } };
        if (mode === "magick" || mode === "montage") {
            const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
            const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
            const chunks: Uint8Array[] = [];
            exitCode = (await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } }, stderr: sink
            })).exitCode;
            bytes = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, mode === "buffered" ? files : {
                    filesystem, cwd: "/", ...(mode === "stream" ? { stderr: sink } : {})
                });
            ({ exitCode, stdoutBytes: bytes } = result);
            stderr += result.stderr;
        }
        expect(exitCode, stderr).toBe(0);
        expect(Buffer.from(bytes!)).toEqual(Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from(test.pixel, "hex")]));
        expect(stderr).toBe(test.warning ? "montage: geometry does not contain image '1x1+0+0'\n" : "");
    });
}

it("rejects missing montage repage geometry", () => {
    expect(runMontageCliSync(["-repage"], new Map())).toMatchObject({
        exitCode: 1, stderr: "montage: missing argument for -repage\n"
    });
});

it.each(["junk", "4x3+1q+1", "A4", "3+2"])("rejects invalid montage repage geometry %s without replacing output", geometry => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["sheet.ppm", original]]);
    const result = runMontageCliSync(["xc:red", "-repage", geometry, "sheet.ppm"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-repage'");
    expect(files.get("sheet.ppm")).toBe(original);
});
