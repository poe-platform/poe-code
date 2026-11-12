import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const source of ["pseudo", "png"])
for (const count of [1, 3])
for (const tile of [1, 2, 3])
for (const adjoin of [[], ["-adjoin"], ["+adjoin"]])
for (const output of (adjoin.includes("+adjoin") ? ["/sheet.tiff", "/sheet-%d.tiff"] : ["/sheet.tiff", "tiff:-", "/sheet-%d.tiff"]))
it(`writes ${count} montage TIFF pages to ${output} via ${mode} from ${source}, tile=${tile}, ${adjoin}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const inputs: string[] = [];
  for (const color of ["red", "blue", "lime"].slice(0, count)) {
    if (source === "pseudo") inputs.push(`xc:${color}`);
    else {
      const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: color } }).png().toBuffer();
      const path = `/input-${color}.png`;
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
      inputs.push(path);
    }
  }
  const args = ["-geometry", source === "png" ? "+0+0" : "1x1+0+0", "-tile", `${tile}x1`, ...adjoin, "-depth", "8", ...inputs, output];
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
  const pageCount = Math.ceil(count / tile);
  const separate = output.includes("%d") || adjoin.includes("+adjoin");
  const expectedNames = output === "tiff:-" ? [] : separate && (pageCount > 1 || output.includes("%d"))
    ? Array.from({ length: pageCount }, (_, index) => `/sheet-${index}.tiff`) : [output];
  expect(names.filter(name => !name.startsWith("/input-")).sort()).toEqual(expectedNames);
  const encoded = output === "tiff:-" ? [Buffer.concat(chunks)]
    : await Promise.all(expectedNames.map(name => retained ? fs.readFile(name) : files.get(name)!));
  if (output !== "tiff:-") expect(chunks).toHaveLength(0);
  let pageIndex = 0;
  for (const bytes of encoded) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = bytes[0] === 73;
    for (let offset = view.getUint32(4, little); offset !== 0;) {
      expect(pageIndex).toBeLessThan(pageCount);
      const page = Uint8Array.from(bytes);
      new DataView(page.buffer).setUint32(4, offset, little);
      const image = decodeImage(page);
      expect([image.width, image.height]).toEqual([tile, 1]);
      const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]];
      expect([...image.data]).toEqual(Array.from({ length: tile }, (_, column) => {
        const index = pageIndex * tile + column;
        return index < count ? colors[index]! : [255, 255, 255, 255];
      }).flat());
      pageIndex++;
      offset = view.getUint32(offset + 2 + view.getUint16(offset, little) * 12, little);
    }
  }
  expect(pageIndex).toBe(pageCount);
});
