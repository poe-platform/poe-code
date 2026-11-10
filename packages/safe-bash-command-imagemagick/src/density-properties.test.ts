import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: density expands before its two axes are parsed.
describe.each(["buffered", "sync", "retained", "command"] as const)("density properties (%s)", mode => {
  for (const output of ["info", "png"]) it.each([
    { name: "option property", input: ["xc:red", "-set", "option:d", "254x127"], density: "%[option:d]", x: 254, y: 127 },
    { name: "image property", input: ["xc:red", "-set", "axes", "254x127"], density: "%[axes]", x: 254, y: 127 },
    { name: "FX axes", input: ["xc:red"], density: "%[fx:3*30]x%[fx:5*10]", x: 90, y: 50 },
    { name: "literal geometry", input: ["xc:red"], density: "254x127", x: 254, y: 127 },
    { name: "first image dimensions", input: ["-size", "3x2", "xc:red", "-size", "1x1", "xc:blue"], density: "%[fx:w*30]x%[fx:h*25]", x: 90, y: 50, count: 2 },
    { name: "captured setting for later input", input: ["xc:red", "-set", "option:d", "254x127"], density: "%[option:d]", after: ["-set", "option:d", "400x200", "xc:blue"], x: 254, y: 127, count: 2 },
  ])(`expands $name for ${output} output`, async ({ input, density, after = [], x, y, count = 1 }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = [...input, "-density", density, ...after, ...(output === "info" ? ["-format", "%x/%y/%U;", "info:-"]
      : [...(count > 1 ? ["-delete", "1"] : []), "PNG24:-"])];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
      : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    if (output === "info") {
      expect(bytes.toString()).toBe(`${x}/${y}/Undefined;`.repeat(count));
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let physical: number[] | undefined;
    for (let offset = 8; offset + 12 <= bytes.length; offset += view.getUint32(offset) + 12) {
      if (view.getUint32(offset + 4) === 0x70485973) {
        physical = [view.getUint32(offset + 8), view.getUint32(offset + 12), bytes[offset + 16]!];
      }
    }
    expect(physical).toEqual([x, y, 0]);
  });
});
