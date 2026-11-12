import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import { compositePixelsSteps } from "./composite-pixels.js";

for (const ArrayType of [Uint8Array, Float64Array]) {
  it(`${ArrayType.name}: None premultiplies destination RGB and preserves opacity`, () => {
    const destination = { width: 1, height: 1, hasAlpha: true, data: new ArrayType([170, 68, 51, 128]) };
    const source = { width: 1, height: 1, hasAlpha: true, data: new ArrayType([36, 104, 172, 176]) };
    const output = new ArrayType(4);
    for (const ignored of compositePixelsSteps(destination, source, output, "None", 0, 0)) { /* drain */ }
    expect(Array.from(output, Math.round)).toEqual([85, 34, 26, 128]);
  });
}

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
const cases = [
  { name: "translucent None", args: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0", "-compose", "None", "-composite"], hex: "55221a80" },
  { name: "opaque None", args: ["-size", "1x1", "xc:#aa4433", "xc:#2468ac", "-compose", "None", "-composite"], hex: "aa4433ff" },
  { name: "alternate opaque None", args: ["-size", "1x1", "xc:#94daf5", "xc:#f6cc83", "-compose", "None", "-composite"], hex: "94daf5ff" },
  { name: "offset layers with None", args: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")", "-background", "#33553370", "-compose", "None", "-flatten"], hex: "162516700a100a700a100a70" },
  { name: "translucent Over", args: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0", "-compose", "Over", "-composite"], hex: "3d6196d8" },
  { name: "translucent Dst", args: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0", "-compose", "Dst", "-composite"], hex: "aa443380" },
];

for (const route of ["command", "buffered", "sync"] as const) {
  it.each(cases)(`${route}: $name matches native RGBA bytes`, async ({ args, hex }) => {
    const argv = [...args, "-depth", "8", "rgba:-"];
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const argumentValues = createCommandArguments(argv);
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(data) { chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data); } },
      stderr: { async write() {} },
    }) : route === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    const output = route === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
