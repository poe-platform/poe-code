import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const samples = [1e-6, 5e-6, 0.125, 0.1234567, 0.3456789, 0.7654321];
const header = Buffer.from("PF\n2 1\n1.0\n");
const fixture = Buffer.alloc(header.length + samples.length * 4);
fixture.set(header);
samples.forEach((sample, index) => fixture.writeFloatBE(sample, header.length + index * 4));

// Payloads captured from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
  { inputs: ["in.pfm"], options: [], format: "pfm", hex: "358637bd36a7c5ac3e0000003dfcd6de3eb0fcd33f43f35c" },
  { inputs: ["in.pfm"], options: ["-flop"], format: "pfm", hex: "3dfcd6de3eb0fcd33f43f35c358637bd36a7c5ac3e000000" },
  { inputs: ["in.pfm"], options: [], format: "phm", hex: "0011005430002fe735883a20" },
  { inputs: ["xc:#804020", "xc:lime", "xc:blue", "xc:white"], options: ["-colorspace", "RGB"], format: "pfm", hex: "00000000000000003f8000003f8000003f8000003f8000003e5d0a893d51ffec3c6ca5df000000003f80000000000000" },
  { inputs: ["xc:#804020", "xc:lime", "xc:blue", "xc:white"], options: [], format: "pfm", hex: "00000000000000003f8000003f8000003f8000003f8000003f0080813e8080813e008081000000003f80000000000000" }
])(`preserves montage floating samples via ${mode}: $inputs $options $format`, async ({ inputs, options, format, hex }) => {
  const files = new Map([["in.pfm", new Uint8Array(fixture)]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.pfm", new Uint8Array(fixture));
  const args = [...inputs, "-tile", inputs.length === 1 ? "1x1" : "2x2", "-geometry", "+0+0", ...options, `${format}:-`];
  let output: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const chunks: Uint8Array[] = [];
    const errors: unknown[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
      stderr: { async write(chunk) { errors.push(chunk); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(errors).toEqual([]);
    output = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const bytes = Buffer.from(output);
  let offset = 0;
  for (let line = 0; line < 3; line++) offset = bytes.indexOf(10, offset) + 1;
  expect(bytes.subarray(0, offset).toString()).toBe(`${format === "phm" ? "PH" : "PF"}\n2 ${inputs.length === 1 ? 1 : 2}\n1.0\n`);
  expect(bytes.subarray(offset).toString("hex")).toBe(hex);
});
