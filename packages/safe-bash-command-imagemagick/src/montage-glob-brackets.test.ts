import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { inputs: ["class-[!ab].ppm"], order: [4, 1, 2] },
  { inputs: ["class-[^ab].ppm"], order: [5, 1, 2] },
  { inputs: ["class-[ab].ppm"], order: [1, 2] },
  { inputs: ["class-[!a-b].ppm"], order: [4, 1, 2] },
  { inputs: ["class-[^a-b].ppm"], order: [5, 1, 2] },
  { inputs: ["class-[!].ppm"], order: [4] },
  { inputs: ["class-[^].ppm"], order: [5] },
])(`matches literal montage bracket punctuation via ${mode}: $inputs`, async ({ inputs, order }) => {
  const files = new Map<string, Uint8Array>();
  for (const [name, red] of [["a", 1], ["b", 2], ["c", 3], ["!", 4], ["^", 5]] as const)
    files.set(`class-${name}.ppm`, new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), red, 0, 0]));
  const fs = new MemoryFileSystem();
  await fs.mkdir("/images");
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
  expect(exitCode, stderr).toBe(0);
  expect(stderr).toBe("");
  expect([...(bytes ?? [])]).toEqual(order.flatMap(red => [red, 0, 0]));
});
