import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sourceRow = "1e506e285a78326482a0968cb4aaa0b9afa5c8beb4";
const monochromeRow = "000000000000000000ffffffffffffffffffffffff";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { name: "unchanged source", inputs: ["/in.ppm"], height: 3, pixels: sourceRow.repeat(3) },
  { name: "monochrome tile", inputs: ["/in.ppm", "-monochrome"], height: 3, pixels: monochromeRow.repeat(3) },
  { name: "grouped monochrome tile", inputs: ["(", "/in.ppm", "-monochrome", ")", "/in.ppm"], height: 6,
    pixels: monochromeRow.repeat(3) + sourceRow.repeat(3) },
  { name: "bilevel control", inputs: ["/in.ppm", "-type", "Bilevel"], height: 3, pixels: monochromeRow.repeat(3) },
])(`renders $name before montage layout via ${mode}`, async ({ inputs, height, pixels }) => {
  const source = Buffer.concat([Buffer.from("P6\n7 3\n255\n"), Buffer.from(sourceRow.repeat(3), "hex")]);
  const args = [...inputs, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
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
  expect(Buffer.from(output)).toEqual(Buffer.concat([
    Buffer.from(`P6\n7 ${height}\n255\n`), Buffer.from(pixels, "hex")
  ]));
});
