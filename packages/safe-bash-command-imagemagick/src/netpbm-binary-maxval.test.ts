import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves binary samples at 16-bit source depth.
// ASCII samples and binary samples below MAXVAL 32768 still scale to Q16.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["P2", "P3", "P5", "P6", "P7"].flatMap(magic => [
    { maxval: 32767, scaled: [0, 2, 40001, 65535] },
    { maxval: 32768, scaled: [0, 2, 39999, 65535] },
    { maxval: 40000, scaled: [0, 2, 32768, 65535] },
    { maxval: 65534, scaled: [0, 1, 20000, 65535] },
    { maxval: 65535, scaled: [0, 1, 20000, 65535] }
  ].map(test => ({ magic, ...test }))))(`${mode}: decodes $magic MAXVAL=$maxval to native gray bytes`, async ({ magic, maxval, scaled }) => {
    const samples = [0, 1, 20000, maxval];
    const ascii = magic === "P2" || magic === "P3";
    const channels = magic === "P3" || magic === "P6" ? 3 : 1;
    const values = samples.flatMap(value => Array<number>(channels).fill(value));
    const header = magic === "P7"
      ? `P7\nWIDTH 4\nHEIGHT 1\nDEPTH 1\nMAXVAL ${maxval}\nTUPLTYPE GRAYSCALE\nENDHDR\n`
      : `${magic}\n4 1\n${maxval}\n`;
    const raster = Buffer.from(values.flatMap(value => [value >>> 8, value & 255]));
    const input = Buffer.concat([Buffer.from(header), ascii ? Buffer.from(values.join(" ") + "\n") : raster]);
    const expected = Buffer.from((!ascii && maxval >= 32768 ? samples : scaled).flatMap(value => [value >>> 8, value & 255]));
    const files = new Map([["/in.pnm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    const argv = ["/in.pnm", "-depth", "16", "-endian", "MSB", "gray:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : undefined).toBe("");
    expect(Buffer.from(mode === "command" ? Buffer.concat(stdout)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array())).toEqual(expected);
  });
}
