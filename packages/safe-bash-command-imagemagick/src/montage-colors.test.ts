import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { colors: 4, hash: "43109c15ed283711e4e4f73b41c3a57f10e95ab9cb7f62bf76ad77c7f7fc7fff" },
  { colors: 8, hash: "dc733a648c674546292475e956352ac2dea73b85c8b956157868b5a930468cec" },
  { colors: 64, hash: "cd1ccfac496edc6d0eb5a4cbb5d74e67d6f4b032ba39c5335b8a50f15f7a75f5" },
])(`matches native montage with $colors colors via ${mode}`, async ({ colors, hash }) => {
  const pixels = Array.from({ length: 64 }, (_, index) => {
    const x = index % 16, y = Math.floor(index / 16);
    return [x * 17, (x * 11 + y * 43) % 256, 255 - x * 13];
  }).flat();
  const source = Buffer.concat([Buffer.from("P6\n16 4\n255\n"), Buffer.from(pixels)]);
  const args = ["/in.ppm", ...(colors === 64 ? [] : ["-colors", String(colors)]), "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "rgb:-"];
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
  expect(output.length).toBe(192);
  expect(new Set(Array.from({ length: 64 }, (_, i) => output.slice(i * 3, i * 3 + 3).join(","))).size).toBe(colors);
  expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});

it.each([
  { args: ["-colors"], message: "missing argument for -colors" },
  { args: ["-colors", "0", "rgb:-"], message: "invalid argument for option '-colors': 0" },
  { args: ["-colors", "banana", "rgb:-"], message: "invalid argument" },
])("rejects invalid montage color counts: $args", async ({ args, message }) => {
  for (const result of [
    runMontageCliSync(["xc:red", ...args], new Map()),
    await runMontageCli(["xc:red", ...args], { filesystem: new MemoryFileSystem(), cwd: "/" })
  ]) {
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  }
});
