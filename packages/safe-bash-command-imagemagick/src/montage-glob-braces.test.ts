import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { inputs: ["brace-{a,b}.ppm"], order: [1, 2] },
  { inputs: ["brace-{a,test}.ppm"], order: [1, 3] },
  { inputs: ["brace-[ab].ppm"], order: [1, 2] },
  { inputs: ["brace-{test,a}.ppm"], order: [1, 3] },
  { inputs: ["brace-{a,a}.ppm"], order: [1] },
  { inputs: ["brace-{a,missing}.ppm"], order: [1] },
  { inputs: ["brace-{a,t*}.ppm"], order: [1, 3] },
  { inputs: ["brace-{z*,b}.ppm"], order: [2] },
  { inputs: ["brace-{a,te}.ppm"], order: [1] },
  { inputs: ["brace-{a}.ppm"], order: [1] },
  { inputs: ["brace-{missing,none}.ppm"], order: [] },
])(`expands quoted montage brace alternatives via ${mode}: $inputs`, async ({ inputs, order }) => {
  const files = new Map<string, Uint8Array>();
  for (const [name, red] of [["a", 1], ["b", 2], ["test", 3], ["unused", 4]] as const)
    files.set(`brace-${name}.ppm`, new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), red, 0, 0]));
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
  expect(exitCode, stderr).toBe(order.length ? 0 : 1);
  if (order.length) expect(stderr).toBe("");
  else expect(stderr).toContain(inputs[0]);
  expect([...(bytes ?? [])]).toEqual(order.flatMap(red => [red, 0, 0]));
});
