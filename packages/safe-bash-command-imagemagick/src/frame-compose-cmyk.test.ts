import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["CMYK", "Multiply", "1x1+0+0", "620814d87ec9032c65e70e395b628a3c7bebcc09ffa0239b7a415184be53871d"],
        ["CMYK", "Xor", "2x2+1+1", "30668688c2ea876f3d4f3f5ba58d0d17471fa79c8746f890be1dc0d8dade4de9"],
        ["CMYK", "Copy", "1x1+0+0", "eb076f7193eec5defcdd257581a4a756c43e2acb539a75910a6b051c0cba7f73"],
        ["CMYK", "Over", "1x1+0+0", "740cf13aa593b1f50974d518e4e316fdc4d83f0a37829d2c940116941c529937"],
        ["sRGB", "Multiply", "1x1+0+0", "c8e9f40b2e40830897ae156715ee9cbdc78b616d3de51fe2aa20c5e69906ea77"],
    ])(`${mode}: matches native %s %s frame %s`, async (space, compose, frame, hash) => {
        const argv = ["xc:#4080c080", "-alpha", "On", "-colorspace", space!, "-mattecolor", "#20402040",
            "-compose", compose!, "-frame", frame!, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let bytes: Buffer;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv), stdout: Buffer[] = [], stderr: Buffer[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
