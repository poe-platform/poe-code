import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMagickCliSync, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
for (const source of ["colors", "miff"] as const)
it.each([
  { operator: [], width: 2, pixels: "ff0000ff00000000ffffffff" },
  { operator: ["-coalesce"], width: 3, pixels: "ff0000ff0000ffffffff00000000ffffffff" },
  { operator: ["-layers", "coalesce"], width: 3, pixels: "ff0000ff0000ffffffff00000000ffffffff" },
  { operator: ["-layers", "Coalesce"], width: 3, pixels: "ff0000ff0000ffffffff00000000ffffffff" },
  { operator: ["-coalesce", "-reverse"], width: 3, pixels: "ff00000000ffffffffff0000ff0000ffffff" },
  { operator: ["-coalesce", "-flop"], width: 3, pixels: "ffffffff0000ff0000ffffff0000ffff0000" },
  { operator: ["-coalesce", "-coalesce"], width: 3, pixels: "ff0000ff0000ffffffff00000000ffffffff" },
  { operator: ["-coalesce", "-delete", "0"], width: 3, pixels: "ff00000000ffffffff", height: 1 },
  { operator: ["-coalesce", "+clone"], width: 3, pixels: "ff0000ff0000ffffffff00000000ffffffffff00000000ffffffff", height: 3 },
].filter(({ operator }) => source === "colors" || operator.length === 1 || operator[0] === "-layers"))(`coalesces positioned montage frames via ${mode}, ${source}: $operator`, async ({ operator, width, pixels, height = 2 }) => {
  const frames = ["-background", "white",
    "(", "-size", "2x1", "xc:red", "-repage", "3x1+0+0", ")",
    "(", "-size", "1x1", "xc:blue", "-repage", "3x1+1+0", ")",
  ];
  const files = new Map<string, Uint8Array>();
  if (source === "miff") expect(runMagickCliSync([...frames, "frames.miff"], files).exitCode).toBe(0);
  const args = [...(source === "miff" ? ["-background", "white", "frames.miff"] : frames),
    ...operator, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
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
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  expect(Buffer.from(output).subarray(0, header.length)).toEqual(header);
  expect(Buffer.from(output).subarray(header.length).toString("hex")).toBe(pixels);
});
