import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, runCompositeCli } from "./index.js";
import fixtures from "./dst-in-fixtures.json" with { type: "json" };

// Original PNG inputs; native ImageMagick 7.1.2-32 preserves RGB and masks alpha.
const native = spawnSync("magick", ["-version"]);

for (const route of ["command", "buffered"])
for (const mode of ["DstIn", "DestIn"])
for (const [left, top] of [[5, 7], [-5, -7], [100, 100]] as const) {
  it(`${route} ${mode} clears uncovered alpha at ${left},${top}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    for (const name of ["base", "overlay"] as const) {
      const bytes = Buffer.from(fixtures[name], "base64");
      files.set(`/${name}.png`, bytes);
      await fs.writeFile(`/${name}.png`, bytes);
    }
    const args = ["-compose", mode, "-geometry", `${left >= 0 ? "+" : ""}${left}${top >= 0 ? "+" : ""}${top}`, "/overlay.png", "/base.png", "/out.png"];
    const result = route === "buffered" ? await runCompositeCli(args, files)
      : await createCompositeCommand().execute({
        command: "composite", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(route === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const base = decodeImage(files.get("/base.png")!);
    const overlay = decodeImage(files.get("/overlay.png")!);
    expect([output.width, output.height]).toEqual([80, 80]);
    const expected = new Uint8Array(base.data);
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
      const sx = x - left, sy = y - top, index = (y * base.width + x) * 4 + 3;
      expected[index] = sx >= 0 && sx < overlay.width && sy >= 0 && sy < overlay.height
        ? Math.round(base.data[index]! * overlay.data[(sy * overlay.width + sx) * 4 + 3]! / 255) : 0;
    }
    expect(output.data).toEqual(expected);
    if (!native.error && route === "command" && mode === "DstIn") {
      const reference = spawnSync("magick", ["composite", ...args.slice(0, 4),
        `inline:data:image/png;base64,${fixtures.overlay}`,
        `inline:data:image/png;base64,${fixtures.base}`, "png:-"]);
      expect(reference.status, reference.stderr.toString()).toBe(0);
      expect(output.data).toEqual(decodeImage(reference.stdout).data);
    }
  });
}
