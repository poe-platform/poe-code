import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; output samples are C, M, Y, K, A.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        [[], "ff0000000000ffffffff00000000ff"],
        [["-channel", "K"], "c6390000400080bfffa0004d0000ee"],
        [["-channel", "R"], "ff39006f400080bf7fa0004d005fee"],
        [["-channel", "A"], "c639006f000080bf7fff004d005fff"],
        [null, "c639006f400080bf7fa0004d005fee"],
    ] as const)(`${mode}: thresholds CMYK ink samples with %j`, async (options, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["out", sentinel]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append", "-colorspace", "CMYK",
            ...(options === null ? [] : [...options, "-lat", "3x1", "+channel"]), "-depth", "8", "cmyka:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each(["cmyka", "rgba"])(`${mode}: preserves Q16 channels and updates the %s backing when thresholding black`, async format => {
        const samples = [32768, 32767, 32768].flatMap((black, i) => [0, 65535, 32768, black, 12345 + i]);
        const input = new Uint8Array(samples.length * 2);
        samples.forEach((value, i) => new DataView(input.buffer).setUint16(i * 2, value));
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const argv = ["-size", "3x1", "-depth", "16", "-endian", "MSB", "cmyka:input",
            "-channel", "K", "-lat", "3x1", "+channel", ...(format === "rgba" ? ["-colorspace", "sRGB"] : []), `${format}:out`];
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        expect(Array.from({ length: output.length / 2 }, (_, i) => view.getUint16(i * 2))).toEqual(
            [65535, 0, 65535].flatMap((black, i) => format === "cmyka" ? [0, 65535, 32768, black, 12345 + i]
                : [65535 - black, 0, black ? 0 : 32767, 12345 + i]),
        );
    });
}
