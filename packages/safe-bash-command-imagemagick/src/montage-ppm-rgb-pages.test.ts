import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const format of ["ppm", "rgb"] as const)
it.each(["plain", "numbered", "stdout"] as const)(`adjoins ${format} montage pages via ${mode}: %s`, async target => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const output = target === "stdout" ? `${format}:-` : `/sheet${target === "numbered" ? "-%02d" : ""}.${format}`;
  const args = ["-geometry", "1x1+0+0", "-tile", "1x1", "-depth", "8", "xc:red", "xc:blue", output];
  const chunks: Uint8Array[] = [];
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { expect(bytes.length).toBe(0); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    if (result.stdoutBytes) chunks.push(result.stdoutBytes);
  }
  const retained = mode === "command" || mode === "retained";
  const names = retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`).sort() : [...files.keys()].sort();
  const header = format === "ppm" ? [...new TextEncoder().encode("P6\n1 1\n255\n")] : [];
  const red = [...header, 255, 0, 0], blue = [...header, 0, 0, 255];
  const read = async (name: string) => Array.from(retained ? await fs.readFile(name) : files.get(name)!);
  if (target === "stdout") {
    expect(names).toEqual([]);
    expect(chunks.flatMap(chunk => [...chunk])).toEqual([...red, ...blue]);
  } else if (target === "numbered") {
    expect(names).toEqual([`/sheet-00.${format}`, `/sheet-01.${format}`]);
    expect(await read(names[0]!)).toEqual(red);
    expect(await read(names[1]!)).toEqual(blue);
    expect(chunks).toEqual([]);
  } else {
    expect(names).toEqual([output]);
    expect(await read(output)).toEqual([...red, ...blue]);
    expect(chunks).toEqual([]);
  }
});
