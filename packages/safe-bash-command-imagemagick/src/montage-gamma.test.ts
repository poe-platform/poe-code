import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI float32 PFM reference samples.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: [], samples: [0.501960813999176, 0.250980406999588, 0.125490203499794] },
  { options: ["-gamma", "1"], samples: [0.501960813999176, 0.250980406999588, 0.125490203499794] },
  { options: ["-gamma", "2"], samples: [0.708491861820221, 0.5009794235229492, 0.3542459309101105] },
  { options: ["-channel", "R", "-gamma", "2"], samples: [0.708491861820221, 0.250980406999588, 0.125490203499794] },
  { options: ["-gamma", "2", "-gamma", "1"], samples: [0.708491861820221, 0.5009794235229492, 0.3542459309101105] },
])(`applies montage gamma to float32 samples via ${mode}: $options`, async ({ options, samples }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const args = ["xc:#804020", "-tile", "1x1", "-geometry", "+0+0", ...options, "pfm:-"];
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
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const bytes = Buffer.from(output);
  let offset = 0;
  for (let line = 0; line < 3; line++) offset = bytes.indexOf(10, offset) + 1;
  expect(bytes.subarray(0, offset).toString()).toBe("PF\n1 1\n1.0\n");
  expect(bytes.length - offset).toBe(12);
  expect([0, 1, 2].map(channel => bytes.readFloatBE(offset + channel * 4))).toEqual(samples.map(Math.fround));
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { options: ["out.pfm", "-gamma"], error: "missing argument for -gamma" },
  { options: ["-gamma", "banana", "out.pfm"], error: "Invalid gamma: banana" },
])(`rejects invalid montage gamma via ${mode}: $options`, async ({ options, error }) => {
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
