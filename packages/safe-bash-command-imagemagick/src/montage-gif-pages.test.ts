import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const source of ["pseudo", "png"])
for (const count of [1, 2])
for (const output of ["/sheet.gif", "gif:-", "/sheet-%d.gif"])
it(`writes ${count} montage GIF pages to ${output} via ${mode} from ${source}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const inputs: string[] = [];
  for (const color of ["red", "blue"].slice(0, count)) {
    if (source === "pseudo") inputs.push(`xc:${color}`);
    else {
      const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: color } }).png().toBuffer();
      const path = `/input-${color}.png`;
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
      inputs.push(path);
    }
  }
  const args = ["-geometry", source === "png" ? "+0+0" : "1x1+0+0", "-tile", "1x1", "-depth", "8", ...inputs, output];
  const chunks: Uint8Array[] = [];
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { expect(new TextDecoder().decode(bytes)).toBe(""); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    if (result.stdoutBytes) chunks.push(result.stdoutBytes);
  }
  const retained = mode === "command" || mode === "retained";
  const names = retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
  const expectedNames = output === "gif:-" ? [] : output.includes("%d")
    ? Array.from({ length: count }, (_, index) => `/sheet-${index}.gif`) : [output];
  expect(names.filter(name => !name.startsWith("/input-")).sort()).toEqual(expectedNames);
  const encoded = output === "gif:-" ? [Buffer.concat(chunks)]
    : await Promise.all(expectedNames.map(name => retained ? fs.readFile(name) : files.get(name)!));
  if (output !== "gif:-") expect(chunks).toHaveLength(0);
  const pixels: number[] = [];
  for (const bytes of encoded) {
    expect(new TextDecoder().decode(bytes).split("GIF8")).toHaveLength(2);
    const image = decodeImage(bytes, { animated: true });
    expect(image.width).toBe(1);
    pixels.push(...image.data);
  }
  expect(pixels).toEqual([255, 0, 0, 255, 0, 0, 255, 255].slice(0, count * 4));
});
