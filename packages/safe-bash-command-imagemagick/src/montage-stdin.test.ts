import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const inputs of [["-", "-"], ["ppm:-", "ppm:-"], ["-", "ppm:-"], ["ppm:-"], ["-", "xc:blue", "ppm:-"], ["-", "-duplicate", "1"], ["-", "(", "+clone", ")"], ["-", "ppm:-", "-reverse"]])
it(`consumes montage stdin once via ${mode}: ${inputs.join(" ")}`, async () => {
  const fs = new MemoryFileSystem();
  const stdin = new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), 255, 0, 0]);
  const args = [...inputs, "-geometry", "+0+0", "-tile", "x1", "-depth", "8", "rgb:-"];
  let bytes: Uint8Array | undefined, stderr = "", exitCode: number;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const chunks: Uint8Array[] = [];
    const context: CommandContext = {
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () { yield stdin; })(),
      stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
    };
    exitCode = (await command.execute(context)).exitCode;
    bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, new Map(), stdin)
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" }, stdin);
    ({ exitCode, stderr, stdoutBytes: bytes } = result);
  }
  const duplicated = inputs.includes("-duplicate") || inputs.includes("+clone");
  expect(Array.from(bytes ?? [])).toEqual(duplicated ? [255, 0, 0, 255, 0, 0]
    : inputs.includes("xc:blue") ? [255, 0, 0, 0, 0, 255] : [255, 0, 0]);
  expect(exitCode).toBe(inputs.length === 1 || duplicated ? 0 : 1);
  if (inputs.length === 1 || duplicated) expect(stderr).toBe("");
  else expect(stderr).toContain(inputs[1] === "-" ? "no decode delegate" : "improper image header");
});
