import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sourceRow = "1e506e285a78326482a0968cb4aaa0b9afa5c8beb4";
const blurredRow = "2254722f5d79517183848c8fa9a39cbab0a7c3b9af";
const input = Buffer.concat([Buffer.from("P6\n7 3\n255\n"), Buffer.from(sourceRow.repeat(3), "hex")]);

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { inputs: ["in.ppm"], rows: sourceRow.repeat(3), height: 3 },
  { inputs: ["in.ppm", "-blur", "0x1"], rows: blurredRow.repeat(3), height: 3 },
  { inputs: ["in.ppm", "-blur", "0x2"], rows: "315c7643687d5e77857b898f979b9aaca9a3bab3aa".repeat(3), height: 3 },
  { inputs: ["(", "in.ppm", "-blur", "0x1", ")", "in.ppm"], rows: blurredRow.repeat(3) + sourceRow.repeat(3), height: 6 }
])(`matches native montage source blur via ${mode}: $inputs`, async ({ inputs, rows, height }) => {
  const args = [...inputs, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
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
    const files = new Map([["in.ppm", input]]);
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  expect(Buffer.from(output)).toEqual(Buffer.concat([
    Buffer.from(`P6\n7 ${height}\n255\n`), Buffer.from(rows, "hex")
  ]));
});
