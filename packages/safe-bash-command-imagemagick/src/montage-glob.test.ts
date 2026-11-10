import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { inputs: ["*.ppm"], order: [0, 1, 2] },
  { inputs: ["?.ppm"], order: [0, 1] },
  { inputs: ["[ab].ppm"], order: [0, 1] },
  { inputs: ["a.ppm", "b.ppm", "two words.ppm"], order: [0, 1, 2] },
  { inputs: ["*.ppm", "-reverse"], order: [2, 1, 0] },
  { inputs: ["b.ppm", "[ab].ppm", "a.ppm"], order: [1, 0, 1, 0] },
  { inputs: ["missing*.ppm"], order: [] },
])(`expands montage filename wildcards via ${mode}: $inputs`, async ({ inputs, order }) => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const files = new Map<string, Uint8Array>();
  for (const [name, color] of [["two words.ppm", 2], ["b.ppm", 1], ["a.ppm", 0], [".hidden.ppm", 0]] as const)
    files.set(name, new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), ...colors[color]!]));
  const fs = new MemoryFileSystem();
  await fs.mkdir("/images");
  await fs.mkdir("/images/directory.ppm");
  for (const [name, bytes] of files) await fs.writeFile(`/images/${name}`, bytes);
  const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "-depth", "8", "rgb:-"];
  let bytes: Uint8Array | undefined, exitCode: number, stderr: string;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/images", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(data) { chunks.push(data.slice()); } },
      stderr: { async write(data) { errors.push(data.slice()); } }, registerCleanup() {}
    };
    ({ exitCode } = await createMagickCommand().execute(context));
    stderr = Buffer.concat(errors).toString();
    bytes = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/images" });
    ({ exitCode, stderr, stdoutBytes: bytes } = result);
  }
  expect(exitCode, stderr).toBe(order.length ? 0 : 1);
  if (order.length) expect(stderr).toBe("");
  else expect(stderr).toContain("missing*.ppm");
  expect([...(bytes ?? [])]).toEqual(order.flatMap(index => colors[index]!));
});
