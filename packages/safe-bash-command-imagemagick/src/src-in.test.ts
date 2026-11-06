import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, runCompositeCli } from "./index.js";
import fixtures from "./src-in-fixtures.json" with { type: "json" };

// Original PNG inputs and expected outputs from ImageMagick 7.1.2-31.
const native = spawnSync("magick", ["-version"]);

for (const route of ["command", "buffered"])
for (const mode of ["SrcIn", "In"])
for (const geometry of ["+5+7", "-5-7", "+100+100"] as const) {
  it(`${route} ${mode} clears uncovered alpha at ${geometry}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    for (const name of ["base", "overlay"] as const) {
      const bytes = Buffer.from(fixtures[name], "base64");
      files.set(`/${name}.png`, bytes);
      await fs.writeFile(`/${name}.png`, bytes);
    }
    const args = ["-compose", mode, "-geometry", geometry, "/overlay.png", "/base.png", "/out.png"];
    const result = route === "buffered" ? await runCompositeCli(args, files)
      : await createCompositeCommand().execute({
        command: "composite", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(route === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([80, 80]);
    const expected = decodeImage(Buffer.from(fixtures[geometry], "base64"));
    expect(output.data).toEqual(expected.data);
    if (!native.error && route === "command" && mode === "SrcIn") {
      const reference = spawnSync("magick", ["composite", ...args.slice(0, 4),
        `inline:data:image/png;base64,${fixtures.overlay}`,
        `inline:data:image/png;base64,${fixtures.base}`, "png:-"]);
      expect(reference.status, reference.stderr.toString()).toBe(0);
      expect(output.data).toEqual(decodeImage(reference.stdout).data);
    }
  });
}
