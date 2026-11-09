import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const cases = [
  { edits: ["-set", "option:thing", "CAT", "-set", "label", "%[option:thing]"], label: "CAT" },
  { edits: ["-set", "option:thing", "CAT", "-set", "label", "%[thing]"], label: "CAT" },
  { edits: ["-set", "artifact:thing", "CAT", "-set", "label", "%[thing]"], label: "CAT" },
  { edits: ["-set", "artifact:thing", "CAT", "-set", "label", "%[artifact:thing]"], label: "CAT" },
  { edits: ["-set", "option:note", "OVERRIDE", "-set", "label", "%[note]:%[option:note]"], label: "original:OVERRIDE" },
  { edits: ["-set", "option:note", "OPTION", "-set", "artifact:note", "ARTIFACT", "-set", "label", "%[note]:%[artifact:note]:%[option:note]"], label: "original:ARTIFACT:OPTION" },
  { edits: ["-set", "option:thing", "OPTION", "-set", "artifact:thing", "ARTIFACT", "-set", "label", "%[thing]"], label: "ARTIFACT" },
  { edits: ["-set", "option:thing", "CAT", "-set", "label", "%[thing]", "-set", "option:thing", "DOG", "-set", "label", "%[label]:%[thing]:%[option:thing]"], label: "CAT:DOG:DOG" },
];

for (const mode of ["buffered", "retained", "command"]) {
  for (const { edits, label } of cases) {
    it(`expands ${edits.join(" ")} through ${mode}`, async () => {
      const fixture = spawnSync("magick", ["-size", "3x2", "xc:#c8591e", "-set", "note", "original", "-set", "comment", "hello", "png:-"]);
      expect(fixture.status).toBe(0);
      const native = spawnSync("magick", ["-", ...edits, "png:-"], { input: fixture.stdout });
      expect(native.status).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.png", fixture.stdout);
      await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
      const files = new Map([["/in.png", new Uint8Array(fixture.stdout)], ["/out.png", new TextEncoder().encode("keep")]]);
      const args = ["/in.png", ...edits, "/out.png"];
      if (mode === "command") {
        expect(await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        })).toMatchObject({ exitCode: 0 });
      } else {
        expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
      for (const input of [native.stdout, output]) {
        const saved = spawnSync("magick", ["identify", "-quiet", "-format", "%[label]", "-"], { input, encoding: "utf8" });
        expect(saved.status, saved.stderr).toBe(0);
        expect(saved.stdout).toBe(label);
        const pixels = spawnSync("magick", ["-", "-depth", "8", "rgb:-"], { input });
        expect(pixels.status).toBe(0);
        expect([...pixels.stdout]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
      }
    });
  }
}
