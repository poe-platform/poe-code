import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: PNG64 output decoded as RGBA16 after CMYK -> sRGB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: [], expected: [0x4040, 0x8080, 0xc0c0, 0x8080] },
        { operations: ["-gamma", "2"], expected: [0x17a0, 0x366b, 0x80c1, 0xb55f] },
        { operations: ["+gamma", "2"], expected: [0x858a, 0xd5aa, 0xf05f, 0x4081] },
        { operations: ["-channel", "Black", "+channel"], expected: [0x4040, 0x8080, 0xc0c0, 0x8080] },
        { operations: ["-channel", "Black", "-gamma", "2", "+channel"], expected: [0x2aeb, 0x55d6, 0x80c1, 0x8080] },
        { operations: ["-channel", "Black", "+gamma", "2", "+channel"], expected: [0x5020, 0xa03f, 0xf05f, 0x8080] },
    ])(`${mode}: applies CMYK gamma $operations before sRGB output`, async ({ operations, expected }) => {
        const args = ["xc:#4080c080", "-colorspace", "CMYK", ...operations, "-colorspace", "sRGB", "PNG64:/out.png"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect(Array.from(output.data16 ?? [])).toEqual(expected);
    });
}
