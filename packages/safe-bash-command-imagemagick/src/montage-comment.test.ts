import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 accepts input comments without copying them to the sheet.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    ["-comment", "proof", "xc:red"],
    ["xc:red", "-comment", "proof"],
    ["+comment", "xc:red"],
    ["xc:red", "+comment"],
    ["-comment", "proof", "+comment", "xc:red"],
    ["-comment", "", "xc:red"],
    ["-comment", "-label", "xc:red"],
    ["xc:red"],
  ])(`${mode} accepts montage input comments: %j`, async (...inputs) => {
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "png:-"];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const result = mode === "magick" || mode === "montage" ? await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = "stdoutBytes" in result ? result.stdoutBytes! : Buffer.concat(chunks);
    expect(decodeImage(bytes)).toMatchObject({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255) });
    const types: string[] = [];
    for (let offset = 8; offset < bytes.length;) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
      types.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
      offset += view.getUint32(0) + 12;
    }
    for (const type of ["pHYs", "tEXt", "zTXt", "iTXt"]) expect(types).not.toContain(type);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`${mode} rejects a missing montage comment argument`, async () => {
    const args = ["xc:red", "-comment"];
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "montage: missing argument for -comment\n" });
    expect(files.size).toBe(0);
    expect(await filesystem.readdir("/")).toEqual([]);
  });
}
