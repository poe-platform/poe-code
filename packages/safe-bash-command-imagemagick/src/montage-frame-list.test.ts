import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { inputs: ["trio.gif"], order: [0, 1, 2] },
  { inputs: ["trio.gif", "-reverse"], order: [2, 1, 0] },
  { inputs: ["trio.gif", "+duplicate"], order: [0, 1, 2, 2] },
  { inputs: ["trio.gif", "-duplicate", "1,1"], order: [0, 1, 2, 1] },
  { inputs: ["trio.gif", "+clone"], order: [0, 1, 2, 2] },
  { inputs: ["trio.gif", "-delete", "1"], order: [0, 2] },
  { inputs: ["trio.gif", "+swap"], order: [0, 2, 1] },
  { inputs: ["trio.gif", "-insert", "0"], order: [2, 0, 1] },
  { inputs: ["trio.gif[0-2]", "-reverse"], order: [2, 1, 0] },
  { inputs: ["trio.gif[1]", "trio.gif", "-reverse"], order: [2, 1, 0, 1] },
  { inputs: ["trio.gif[0]", "(", "trio.gif", "-reverse", ")"], order: [0, 2, 1, 0] },
  { inputs: ["trio.gif", "(", "-clone", "1", ")"], order: [0, 1, 2, 1] },
])(`applies montage operators to frames via ${mode}: $inputs`, async ({ inputs, order }) => {
  const files = new Map<string, Uint8Array>();
  expect(runMagickCliSync(["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "trio.gif"], files).exitCode).toBe(0);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/trio.gif", files.get("trio.gif")!);
  const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "-depth", "8", "rgb:-"];
  let bytes: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(data) { chunks.push(data.slice()); } },
      stderr: { async write(data) { errors.push(data.slice()); } }, registerCleanup() {}
    };
    const result = await createMagickCommand().execute(context);
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    bytes = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    bytes = result.stdoutBytes!;
  }
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  expect([...bytes]).toEqual(order.flatMap(index => colors[index]!));
});
