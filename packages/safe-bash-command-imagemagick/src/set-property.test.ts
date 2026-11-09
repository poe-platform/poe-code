import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const extension of ["png", "jpg", "gif", "tiff"]) {
  for (const mode of ["buffered", "retained", "command"]) {
    for (const operation of [[], ["-flop"], ["-strip"]]) {
      it(`writes expanded properties to ${extension} through ${mode} after ${operation.join(" ")}`, async () => {
        const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "-set", "comment", "old-note", `${extension}:-`]);
        expect(fixture.status).toBe(0);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", fixture.stdout);
        const files = new Map([["/input", new Uint8Array(fixture.stdout)]]);
        const outputPath = `/output.${extension}`;
        const edits = ["-set", "comment", "width=%w", "-set", "label", "%[comment]-label", "-set", "asset", "new-code"];
        const args = ["/input", ...operation, ...edits, outputPath];
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
        const output = mode === "buffered" ? files.get(outputPath)! : await fs.readFile(outputPath);
        const format = extension === "png" ? "%[comment]|%[label]|%[asset]" : "%[comment]";
        const native = spawnSync("magick", ["identify", "-quiet", "-format", format, "-"], { input: output, encoding: "utf8" });
        expect(native.status, native.stderr).toBe(0);
        expect(native.stdout).toBe(extension === "png" ? "width=2|width=2-label|new-code" : "width=2");
      });
    }
  }
}

for (const mode of ["buffered", "retained", "command"]) {
  it(`expands property names against the current image through ${mode}`, async () => {
    const fixture = spawnSync("magick", ["-size", "3x2", "xc:#c8591e", "-set", "note", "original", "png:-"]);
    expect(fixture.status).toBe(0);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", fixture.stdout);
    await fs.writeFile("/output.png", new TextEncoder().encode("keep"));
    const files = new Map([["/input.png", new Uint8Array(fixture.stdout)], ["/output.png", new TextEncoder().encode("keep")]]);
    const edits = ["-set", "%[note]", "copied", "-set", "note", "updated", "-set", "%[note]", "%[original]-%w", "-set", "label", "%[updated]"];
    const args = ["/input.png", ...edits, "/output.png"];
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
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    const properties = spawnSync("magick", ["identify", "-quiet", "-format", "%[original]|%[updated]|%[label]", "-"], { input: output, encoding: "utf8" });
    expect(properties.status, properties.stderr).toBe(0);
    expect(properties.stdout).toBe("copied|copied-3|copied-3");
    expect(Buffer.from(output).includes(Buffer.from("%[note]"))).toBe(false);
    const pixels = spawnSync("magick", ["-", "-depth", "8", "rgb:-"], { input: output });
    expect(pixels.status).toBe(0);
    expect([...pixels.stdout]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
  });
}
