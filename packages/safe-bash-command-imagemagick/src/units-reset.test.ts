import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    {
      name: "resets future inputs without changing loaded images",
      args: ["-units", "PixelsPerInch", "xc:red", "+units", "xc:blue", "-density", "100x50", "-format", "%x/%y/%U;", "info:-"],
      expected: "100/50/PixelsPerInch;100/50/Undefined;"
    },
    {
      name: "clears units before reading an image",
      args: ["-units", "PixelsPerInch", "+units", "xc:red", "-density", "100x50", "PNG24:-"],
      expected: [100, 50, 0]
    },
    {
      name: "preserves loaded image resolution when writing PNG",
      args: ["xc:red", "-units", "PixelsPerInch", "-density", "254x127", "+units", "PNG24:-"],
      expected: [10000, 5000, 1]
    },
    {
      name: "keeps centimeter units without a reset",
      args: ["xc:red", "-units", "PixelsPerCentimeter", "-density", "100x50", "-format", "%x/%y/%U;", "info:-"],
      expected: "100/50/PixelsPerCentimeter;"
    },
    {
      name: "accepts repeated resets without consuming the next operand",
      args: ["+units", "+units", "xc:red", "-density", "100x50", "PNG24:-"],
      expected: [100, 50, 0]
    },
    {
      name: "allows a later units property assignment after reset",
      args: ["xc:red", "-units", "PixelsPerInch", "+units", "-set", "units", "PixelsPerCentimeter", "-density", "100x50", "-format", "%x/%y/%U;", "info:-"],
      expected: "100/50/PixelsPerCentimeter;"
    }
  ])(`$name (${mode})`, async ({ args, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const chunks: Uint8Array[] = [];
    const result = mode === "command"
      ? { ...await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write() {} } }), stdoutBytes: Buffer.concat(chunks), stdout: "" }
      : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = result.stdoutBytes ?? new TextEncoder().encode(result.stdout);
    if (typeof expected === "string") {
      expect(new TextDecoder().decode(output)).toBe(expected);
    } else {
      const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
      const physical = [];
      for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
        if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs") {
          physical.push([png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)]);
        }
      }
      expect(physical).toEqual([expected]);
    }
  });
}
