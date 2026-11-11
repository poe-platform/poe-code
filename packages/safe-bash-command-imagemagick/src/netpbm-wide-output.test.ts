import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runConvertCli, runMagickCliSync} from "./index.js";

const input = Buffer.concat([Buffer.from("P5\n4 1\n65535\n"), Buffer.from("000000017fffffff", "hex")]);

for (const format of ["pgm", "ppm", "pam"] as const) {
  for (const [depth, maximum, hex] of [
    [undefined, 65535, "000000017fffffff"],
    [9, 511, "0000000000ff01ff"],
    [17, 131071, "00000000000000020000fffe0001ffff"],
    [24, 16777215, "0000000000000100007fff7f00ffffff"],
    [32, 4294967295, "00000000000100017fff7fffffffffff"]
  ] as const) {
    it.each(["command", "buffered", "retained", "sync"] as const)(`writes ${format} depth ${depth ?? "default"} as exact big-endian bytes through %s`, async execution => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.pnm", input);
      const files = new Map<string, Uint8Array>([["in.pnm", input]]);
      const args = ["in.pnm", ...(depth === undefined ? [] : ["-depth", String(depth)]), `${format}:-`];
      let output: Uint8Array;
      if (execution === "command") {
        const values = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write(bytes) {chunks.push(bytes.slice());}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        output = Buffer.concat(chunks);
      } else {
        const result = execution === "sync" ? runMagickCliSync(args, files)
          : await runConvertCli(args, execution === "retained" ? {filesystem: fs, cwd: "/"} : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        output = result.stdoutBytes!;
      }
      const raster = Buffer.from(hex, "hex");
      const sampleBytes = depth !== undefined && depth > 16 ? 4 : 2;
      const header = format === "pam" ? `P7\nWIDTH 4\nHEIGHT 1\nDEPTH 1\nMAXVAL ${maximum}\nTUPLTYPE GRAYSCALE\nENDHDR\n` : `${format === "pgm" ? "P5" : "P6"}\n4 1\n${maximum}\n`;
      const samples = format === "ppm" ? Buffer.concat(Array.from({length: 4}, (_, i) => Buffer.concat(Array(3).fill(raster.subarray(i * sampleBytes, (i + 1) * sampleBytes))))) : raster;
      expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(header), samples]));
    });
  }
}

it.each(["buffered", "retained", "sync"] as const)("retains wide depth for intermediate writes and resets it with +depth through %s", async execution => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.pnm", input);
  const files = new Map<string, Uint8Array>([["in.pnm", input]]);
  const args = ["in.pnm", "-depth", "24", "-write", "first.pgm", "+depth", "last.pgm"];
  const result = execution === "sync" ? runMagickCliSync(args, files)
    : await runConvertCli(args, execution === "retained" ? {filesystem: fs, cwd: "/"} : files);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const first = execution === "retained" ? await fs.readFile("/first.pgm") : files.get("first.pgm")!;
  const last = execution === "retained" ? await fs.readFile("/last.pgm") : files.get("last.pgm")!;
  expect(Buffer.from(first)).toEqual(Buffer.concat([Buffer.from("P5\n4 1\n16777215\n"), Buffer.from("0000000000000100007fff7f00ffffff", "hex")]));
  expect(Buffer.from(last)).toEqual(input);
});
