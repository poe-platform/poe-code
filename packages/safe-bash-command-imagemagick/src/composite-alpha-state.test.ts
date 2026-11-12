import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
  { modes: ["DstOut", "DestOut"], base: "blue", source: "red", rgb: [0, 0, 0], alpha: 0 },
  { modes: ["SrcIn", "In"], base: "blue", source: "#ff000080", rgb: [128, 0, 0], alpha: 128 },
  { modes: ["DstIn", "DestIn"], base: "blue", source: "#ff000080", rgb: [0, 0, 255], alpha: 128 },
  { modes: ["SrcOut", "Out"], base: "blue", source: "#ff000080", rgb: [0, 0, 0], alpha: 0 },
  { modes: ["DstOut", "DestOut"], base: "blue", source: "#ff000080", rgb: [0, 0, 255], alpha: 127 },
  { modes: ["Blend"], base: "#203060", source: "#e0502080", rgb: [96, 59, 75], alpha: 192 },
];
const native = spawnSync("magick", ["-version"]);

for (const route of ["command", "buffered", "sync"])
for (const alphaOn of [false, true])
for (const { modes, base, source, rgb, alpha } of cases)
for (const mode of modes) {
  it(`${route}: ${mode} preserves destination alpha enabled=${alphaOn}`, async () => {
    const fs = createMemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = ["-size", "1x1", `xc:${base}`, ...(alphaOn ? ["-alpha", "on"] : []),
      "-size", "1x1", `xc:${source}`, "-define", "compose:args=50", "-compose", mode, "-composite"];
    const result = route === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments([...args, "/out.png"]).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : route === "sync" ? runMagickCliSync([...args, "/out.png"], files)
      : await runMagickCli([...args, "/out.png"], files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(route === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect(output.data[3]).toBe(alphaOn ? alpha : 255);
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(output.data[channel]! - rgb[channel]!)).toBeLessThanOrEqual(mode === "Blend" ? 1 : 0);
    }
    expect(output.hasAlpha).toBe(alphaOn);
    if (!native.error) {
      const reference = spawnSync("magick", [...args.map(arg => arg === mode ? modes[0]! : arg), "png:-"]);
      expect(reference.status, reference.stderr.toString()).toBe(0);
      const expected = decodeImage(reference.stdout);
      expect(output.hasAlpha).toBe(expected.hasAlpha);
      expect(output.data[3]).toBe(expected.data[3]);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(output.data[channel]! - expected.data[channel]!)).toBeLessThanOrEqual(mode === "Blend" ? 1 : 0);
      }
    }
  });
}
