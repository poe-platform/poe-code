import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const property of ["comment", "label"]) {
    for (const options of [
      [`-${property}`, "prefix", "input.png"],
      ["input.png", `-${property}`, "post"],
      [`-${property}`, "prefix", "input.png", "-set", property, "changed"],
      [`-${property}`, "%wx%h", "input.png"],
      [`-${property}`, "first", "input.png", `-${property}`, "second", "input.png", "-delete", "0"],
    ]) {
      it(`${mode}: ${options.join(" ")}`, async () => {
        const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "-set", "comment", "old-note", "-set", "label", "old-label", "-set", "asset", "old-code", "png:-"]);
        expect(fixture.status).toBe(0);
        const native = spawnSync("magick", ["png:-", "-write", "mpr:fixture", "+delete", ...options.map(value => value === "input.png" ? "mpr:fixture" : value), "png:-"], { input: fixture.stdout });
        expect(native.status, native.stderr.toString()).toBe(0);
        const expected = spawnSync("magick", ["identify", "-quiet", "-format", "%wx%h|%[comment]|%[label]|%[asset]", "-"], { input: native.stdout, encoding: "utf8" });
        expect(expected.status, expected.stderr).toBe(0);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", fixture.stdout);
        const files = new Map([["input.png", new Uint8Array(fixture.stdout)]]);
        const args = [...options, "output.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("output.png")! : await fs.readFile("/output.png");
        const actual = spawnSync("magick", ["identify", "-quiet", "-format", "%wx%h|%[comment]|%[label]|%[asset]", "-"], { input: output, encoding: "utf8" });
        expect(actual.status, actual.stderr).toBe(0);
        expect(actual.stdout).toBe(expected.stdout);
      });
    }
  }
}

for (const retained of [false, true]) {
  it(`applies input text settings through mogrify (retained=${retained})`, async () => {
    const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "png:-"]);
    expect(fixture.status).toBe(0);
    const files = new Map([["input.png", new Uint8Array(fixture.stdout)]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", fixture.stdout);
    expect(await runMogrifyCli(["-comment", "note", "-label", "title", "input.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/input.png") : files.get("input.png")!;
    const actual = spawnSync("magick", ["identify", "-format", "%[comment]|%[label]", "-"], { input: output, encoding: "utf8" });
    expect(actual.stdout).toBe("note|title");
  });
}
