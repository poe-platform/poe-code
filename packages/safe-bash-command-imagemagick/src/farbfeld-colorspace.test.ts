import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const header = "6661726266656c640000000200000001";
const input = Buffer.from(header + "1234abcd8001000080011235cdef8000", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: in.ff -colorspace <space> ff:-.
const payloads = {
    HSL: "73d5cef25f010000c39ed66870128000",
    CMYK: "e4df00004143000060e0e95d00008000",
    Lab: "9fb150ca8c5c00005e12c6b737fb8000",
    HWB: "73d5123454320000c39e123532108000",
    Oklab: "a8c45ee1880b00007cdea2b54b888000",
    XYZ: "2fe14efa409000003368181296028000",
    YCbCr: "78e4840436c30000487ccb56a7a28000",
    sRGB: "1234abcd8001000080011235cdef8000",
    RGB: "0190686e36cd000036cd01909c838000",
    Gray: "87fa87fa87fa0000371b371b371b8000",
};

const cases = [
    ...Object.entries(payloads).map(([space, payload]) => ({ name: space, options: ["-colorspace", space], payload })),
    { name: "CMYK with inactive alpha", options: ["-colorspace", "CMYK", "-alpha", "off"], payload: "e4df00004143ffff60e0e95d0000ffff" },
    { name: "HSL at depth 8", options: ["-colorspace", "HSL", "-depth", "8"], payload: "7373cece5f5f0000c3c3d6d670708080" },
    { name: "HSL outside the quantum range", options: ["-colorspace", "HSL", "-evaluate", "Multiply", "2"], payload: "e7aaffffbe010000ffffffffe024ffff" },
    { name: "sRGB above the quantum range", options: ["-evaluate", "Multiply", "2"], payload: "2468ffffffff0000ffff246affffffff" },
    { name: "sRGB below the quantum range", options: ["-evaluate", "Subtract", "30%"], payload: "00005f00333400003334000081223333" },
];

for (const mode of ["sync", "buffered", "command"] as const) {
    for (const target of ["/out.ff", "ff:-"]) {
        for (const write of [false, true]) {
            for (const { name, options, payload } of cases) {
                it(`${mode} ${write ? "-write" : "output"} ${target} exports ${name} samples and independent alpha`, async () => {
                    const files = new Map([["/in.ff", input]]), fs = new MemoryFileSystem();
                    await fs.writeFile("/in.ff", input);
                    const args = ["/in.ff", ...options, ...(write ? ["-write", target, "null:"] : [target])];
                    const stdout: Uint8Array[] = [];
                    let stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
                    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                    const bytes = target === "ff:-"
                        ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined
                        : mode === "command" ? await fs.readFile(target) : files.get(target);
                    expect(bytes).toBeInstanceOf(Uint8Array);
                    expect(Buffer.from(bytes!).toString("hex")).toBe(header + payload);
                });
            }
        }
    }
}

for (const space of ["CMYK", "HSL"] as const) {
    it(`streams ${space} samples across storage chunks`, async () => {
        const fs = new MemoryFileSystem();
        const source = Buffer.concat([input.subarray(0, 16), ...Array.from({ length: 513 }, () => input.subarray(16))]);
        source.writeUInt32BE(1026, 8);
        await fs.writeFile("/in.ff", source);
        const result = await runConvertCli(["/in.ff", "-colorspace", space, "/out.ff"], { filesystem: fs, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const expected = Buffer.concat([source.subarray(0, 16), ...Array.from({ length: 513 }, () => Buffer.from(payloads[space], "hex"))]);
        expect(await fs.readFile("/out.ff")).toEqual(new Uint8Array(expected));
    });
}
