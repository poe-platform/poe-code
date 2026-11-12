import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "montage-command", "retained", "buffered", "sync"] as const) {
  it.each(["RLE", "Zip", "None"])(`${mode} writes uncompressed truecolor BMP with -compress %s`, async compression => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-compress", compression, "bmp:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = mode === "command" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
    const result = mode === "command" || mode === "montage-command" ? await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(28, true)).toBe(24);
    expect(view.getUint32(30, true)).toBe(0);
    expect([view.getInt32(38, true), view.getInt32(42, true)]).toEqual([0, 0]);
    const decoded = decodeImage(bytes);
    expect([decoded.width, decoded.height]).toEqual([2, 1]);
    expect(Buffer.from(decoded.data).toString("hex")).toBe("ff0000ff0000ffff");
  });
}
