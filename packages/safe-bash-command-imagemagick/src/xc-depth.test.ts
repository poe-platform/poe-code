import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pamSamples = [5000, 5000, 5000, 0, 10000, 10001, 10000, 0, 32767, 32767, 32767, 32768,
    50000, 16000, 38000, 32768, 10001, 10000, 10000, 65535];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    { input: "xc:#123456789abc", operations: [], expected: [0x1234, 0x5678, 0x9abc, 0xffff] },
    { input: "xc:#123456789abc2345", operations: [], expected: [0x1234, 0x5678, 0x9abc, 0x2345] },
    { input: "xc:#123456789abc2345", operations: ["-negate"], expected: [0xedcb, 0xa987, 0x6543, 0xdcba] },
    { input: "canvas:#123456789abc2345", operations: [], expected: [0x1234, 0x5678, 0x9abc, 0x2345] },
    { input: "xc:#121234345656", operations: [], expected: [0x1212, 0x3434, 0x5656, 0xffff] },
    { input: "xc:#802040", operations: [], expected: [0x8080, 0x2020, 0x4040, 0xffff] },
    { input: "in.pam", operations: [], expected: pamSamples }
])(`${mode} preserves RGBA16 samples for $input $operations`, async ({ input, operations, expected }) => {
    const pixels = Buffer.alloc(pamSamples.length * 2);
    pamSamples.forEach((value, index) => pixels.writeUInt16BE(value, index * 2));
    const pam = Buffer.concat([Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels]);
    const files = new Map<string, Uint8Array>([["in.pam", pam], ["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = createCommandArguments([input, ...operations, "PNG64:out"]);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
        argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
        : mode === "sync" ? runConvertCliSync(args.args, files)
        : await runConvertCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!);
    expect(Array.from(output.data16 ?? [])).toEqual(expected);
});
