import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian RGBA16 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
  { amount: "100x100", alpha: "", operation: "-composite", hex: "f3f3c6c6b9b9ffff" },
  { amount: "80x80", alpha: "", operation: "-composite", hex: "c3299f059494ffff" },
  { amount: "50x50", alpha: "", operation: "-composite", hex: "79fa63635cddffff" },
  { amount: "30x70", alpha: "", operation: "-composite", hex: "5daa64977528ffff" },
  { amount: undefined, alpha: "", operation: "-composite", hex: "f3f3c6c6b9b9ffff" },
  { amount: "100x100", alpha: "c0", operation: "-composite", hex: "b7ae95aa8bd7ffff" },
  { amount: undefined, alpha: "", operation: "-flatten", hex: "ffffffffffffffff" },
  { amount: "80x80", alpha: "", operation: "-flatten", hex: "ffffffffe67fffff" },
];

for (const route of ["command", "sync", "buffered", "retained"] as const)
for (const depth of [8, 16])
for (const activateAlpha of [false, true])
it.each(cases)(`${route} RGBA${depth} alpha=${activateAlpha} $operation Blend $amount opacity=$alpha preserves brightness`, async ({ amount, alpha, operation, hex }) => {
  const argv = [`xc:#336699${alpha}`, ...(activateAlpha ? ["-alpha", "on"] : []), `xc:#c06020${alpha}`,
    "-compose", "Blend", ...(amount === undefined ? [] : ["-define", `compose:args=${amount}`]),
    operation, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
  const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
  let stderr = "";
  const result = route === "command" ? await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  }) : route === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
  expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
    .toEqual({ exitCode: 0, stderr: "" });
  const bytes = route === "command" ? Buffer.concat(stdout)
    : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
  const expected = depth === 16 ? Buffer.from(hex, "hex") : Uint8Array.from({ length: 4 }, (_, channel) =>
    Math.round(Buffer.from(hex, "hex").readUInt16BE(channel * 2) / 257));
  expect(Buffer.from(bytes)).toEqual(Buffer.from(expected));
});
