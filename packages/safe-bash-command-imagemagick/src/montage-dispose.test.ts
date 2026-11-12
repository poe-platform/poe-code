import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const target of ["gif:-", "/sheet.gif"])
  it.each([
    { options: [], disposal: 0 },
    { options: ["-dispose", "Background"], disposal: 2 },
    { options: ["-dispose", "Previous"], disposal: 3 },
    { options: ["-dispose", "None"], disposal: 1 },
    { options: ["-dispose", "Undefined"], disposal: 0 },
    { options: ["-dispose", "2"], disposal: 2 },
    { options: ["-dispose", "pReViOuS"], disposal: 3 },
    { options: ["-dispose", "Background", "+dispose"], disposal: 0 },
    { options: ["-dispose", "Background", "-dispose", "Previous"], disposal: 3 }
  ])(`${mode} writes disposal $disposal on every GIF montage page to ${target}`, async ({ options, disposal }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:red", "xc:blue", "-tile", "1x1", "-geometry", "+0+0", ...options, target];
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
    const output = target !== "gif:-"
      ? mode === "buffered" || mode === "sync" ? files.get(target)! : await fs.readFile(target)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    const image = decodeImage(output, { animated: true });
    expect(image).toMatchObject({ width: 1, height: 2, pages: 2, pageHeight: 1, delay: [0, 0], loop: 0 });
    for (const page of [0, 1]) expect(decodeImage(output, { page, coalesce: false }).disposal).toBe(disposal);
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
  it.each([
    { options: ["-dispose"], error: "missing argument for -dispose" },
    { options: ["-dispose", "invalid", "/sheet.gif"], error: "unrecognized dispose method '-dispose' 'invalid'" }
  ])(`${mode} rejects invalid disposal without replacing output: $options`, async ({ options, error }) => {
    const original = new Uint8Array([1, 2, 3]);
    const fs = new MemoryFileSystem(), files = new Map([["/sheet.gif", original]]);
    await fs.writeFile("/sheet.gif", original);
    const args = ["xc:red", ...options];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await fs.readFile("/sheet.gif") : files.get("/sheet.gif")).toEqual(original);
  });
}
