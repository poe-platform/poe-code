import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const override of [false, true]) {
    it(`writes every PNG frame's comment into an assembled GIF (${mode}, override=${override})`, async () => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      for (const [name, color, comment] of [["a.png", "red", "Alice"], ["b.png", "blue", "Bob"]]) {
        const fixture = spawnSync("magick", ["-size", "3x2", `xc:${color}`, "-set", "comment", comment!, "png:-"]);
        expect(fixture.status, fixture.stderr.toString()).toBe(0);
        files.set(name!, new Uint8Array(fixture.stdout));
        await fs.writeFile(`/${name}`, fixture.stdout);
      }
      const args = ["a.png", "b.png", ...(override ? ["-set", "comment", "marker"] : []), "out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
      const actual = spawnSync("magick", ["identify", "-format", "%c;%wx%h;%[pixel:p{0,0}]\\n", "-"], { input: output, encoding: "utf8" });
      expect(actual.status, actual.stderr).toBe(0);
      expect(actual.stdout).toBe(`${override ? "marker" : "Alice"};3x2;srgb(255,0,0)\n${override ? "marker" : "Bob"};3x2;srgb(0,0,255)\n`);
    });
  }
}
