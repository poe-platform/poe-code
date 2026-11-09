import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
  it(`expands wildcard properties into sorted, terminated key=value lines through ${mode}`, async () => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#c8591e" } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
    const files = new Map([["/in.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
    const args = ["/in.png", "-set", "notebook", "second", "-set", "note", "original", "-set", "noise", "literal %%w",
      "-set", "label", "%[not*]|%[NO?E]|%[no[t]*]|<%[zz*]>|<%[wid*]>|%[note]|%[noi*]", "/out.png"];
    if (mode === "command") {
      expect(await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      })).toMatchObject({ exitCode: 0 });
    } else {
      expect(mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
    expect((await sharp(output).metadata()).properties?.label)
      .toBe("note=original\nnotebook=second\n|note=original\n|note=original\nnotebook=second\n|<>|<>|original|noise=literal %w\n");
    expect(await sharp(output).removeAlpha().raw().toBuffer()).toEqual(await sharp(input).removeAlpha().raw().toBuffer());
    const identify = ["identify", "-format", "%[not*]|<%[zz*]>", "/out.png"];
    expect(await runMagickCli(identify, mode === "retained" || mode === "command" ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "note=original\nnotebook=second\n|<>", stderr: "" });
  });
}
