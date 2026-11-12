import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const count of [1, 2])
for (const coder of ["gif87", "gif"])
it(`${mode} writes a single ${coder} page with ${count} tiles`, async () => {
  const fs = new MemoryFileSystem();
  const args = [...["xc:red", "xc:blue"].slice(0, count), "-tile", `${count}x1`, "-geometry", "+0+0", `${coder}:-`];
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
  const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
  const result = mode === "magick" || mode === "montage" ? await command.execute({
    command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  }) : mode === "sync" ? runMontageCliSync(args, new Map())
    : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
  expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe(coder === "gif87" ? "GIF87a" : "GIF89a");
  const image = decodeImage(bytes, { animated: true });
  expect(image.width).toBe(count);
  expect(image.height).toBe(1);
  expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255].slice(0, count * 4));
});
