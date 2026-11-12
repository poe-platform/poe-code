import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference raster hashes.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { inputs: ["-dither", "None", "-colors", "4"], hash: "006e4dca114dc5c38ba51081becb1f76ebe342b95d84a60ea022522050c8a9b2" },
  { inputs: ["+dither", "-colors", "4"], hash: "006e4dca114dc5c38ba51081becb1f76ebe342b95d84a60ea022522050c8a9b2" },
  { inputs: ["-dither", "FloydSteinberg", "-colors", "4"], hash: "426e524b6c3bcf12a869abbdcfd6bf481abf386a69c2c3165a9834ad82db944b" },
  { inputs: ["-dither", "None", "-type", "Bilevel"], hash: "9d182a6d4f61e07df0a3adc162203a21ae1899a6ce4e5033c6a9107b3712318b" },
  { inputs: ["-type", "Bilevel"], hash: "9d182a6d4f61e07df0a3adc162203a21ae1899a6ce4e5033c6a9107b3712318b" },
])(`matches native montage dithering via ${mode}: $inputs`, async ({ inputs, hash }) => {
  const source = Buffer.concat([Buffer.from("P6\n16 4\n255\n"), Buffer.from(
    Array.from({ length: 64 }, (_, i) => {
      const x = i % 16, y = Math.floor(i / 16);
      return [x * 17, (x * 11 + y * 43) % 256, 255 - x * 13];
    }).flat()
  )]);
  const args = ["/in.ppm", ...inputs, "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "rgb:-"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", source);
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
    const files = new Map([["/in.ppm", source]]);
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  expect(output).toHaveLength(192);
  expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
