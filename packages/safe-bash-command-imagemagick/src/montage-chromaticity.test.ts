import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: [], coordinates: [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000] },
  { options: ["-red-primary", "0.65,0.34"], coordinates: [31270, 32900, 65000, 34000, 30000, 60000, 15000, 6000] },
  { options: ["-green-primary", "0.28,0.59", "-blue-primary", "0.14,0.08"], coordinates: [31270, 32900, 64000, 33000, 28000, 59000, 14000, 8000] },
  { options: ["-white-point", "0.3,0.32"], coordinates: [30000, 32000, 64000, 33000, 30000, 60000, 15000, 6000] },
])(`writes montage PNG chromaticities without changing samples via ${mode}: $options`, async ({ options, coordinates }) => {
  const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, "png24:-"];
  const fs = new MemoryFileSystem();
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const bytes = Buffer.from(output);
  const chunks = new Map<string, Buffer>();
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    chunks.set(bytes.toString("ascii", offset + 4, offset + 8), bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  expect(chunks.get("cHRM")).toBeDefined();
  expect(Array.from({ length: 8 }, (_, index) => chunks.get("cHRM")!.readUInt32BE(index * 4))).toEqual(coordinates);
  expect(chunks.get("bKGD")).toEqual(Buffer.from([0, 255, 0, 255, 0, 255]));
  const image = decodeImage(output);
  expect([image.width, image.height]).toEqual([2, 1]);
  expect(Buffer.from(image.data).toString("hex")).toBe("ff0000ff0000ffff");
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { options: ["out.pfm", "-red-primary"], error: "missing an argument for option '-red-primary'" },
  { options: ["-red-primary", "banana", "out.pfm"], error: "invalid argument for option '-red-primary': banana" },
])(`rejects invalid montage chromaticity via ${mode}: $options`, async ({ options, error }) => {
  const original = new TextEncoder().encode("existing output");
  const files = new Map([["out.pfm", original]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out.pfm", original);
  const args = ["xc:#804020", ...options];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
  expect(mode === "retained" ? await fs.readFile("/out.pfm") : files.get("out.pfm")).toEqual(original);
});
