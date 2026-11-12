import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const tile of [1, 2])
for (const adjoin of [[], ["-adjoin"], ["+adjoin"]])
for (const output of ["/sheet.ico", "ico:-", "/sheet-%d.ico"])
it(`writes montage ICO pages to ${output} via ${mode}, tile=${tile}, ${adjoin}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const args = ["-size", "16x16", "xc:red", "xc:blue", "-geometry", "+0+0", "-tile", `${tile}x1`, ...adjoin, output];
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
  const pageCount = Math.ceil(2 / tile);
  const separate = output.includes("%d") || adjoin.includes("+adjoin");
  const expectedNames = output === "ico:-" ? [] : separate && (pageCount > 1 || output.includes("%d"))
    ? Array.from({ length: pageCount }, (_, index) => `/sheet-${index}.ico`) : [output];
  expect(names.sort()).toEqual(expectedNames);
  const encoded = output === "ico:-" ? [Buffer.concat(chunks)]
    : await Promise.all(expectedNames.map(name => retained ? fs.readFile(name) : files.get(name)!));
  if (output !== "ico:-") expect(chunks).toHaveLength(0);
  let pageIndex = 0;
  for (const bytes of encoded) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let directory = 0;
    while (directory < bytes.length) {
      expect([...bytes.slice(directory, directory + 4)]).toEqual([0, 0, 1, 0]);
      const entries = view.getUint16(directory + 4, true);
      expect(entries).toBe(separate ? 1 : pageCount);
      let end = 6 + entries * 16;
      for (let entry = 0; entry < entries; entry++) {
        const position = directory + 6 + entry * 16;
        const length = view.getUint32(position + 8, true);
        const offset = view.getUint32(position + 12, true);
        expect(offset).toBe(end);
        // Decode each indexed payload as its own icon to verify every page.
        const icon = new Uint8Array(22 + length);
        icon.set([0, 0, 1, 0, 1, 0]);
        icon.set(bytes.subarray(position, position + 16), 6);
        new DataView(icon.buffer).setUint32(18, 22, true);
        icon.set(bytes.subarray(directory + offset, directory + offset + length), 22);
        const image = decodeImage(icon);
        expect([image.width, image.height]).toEqual([tile * 16, 16]);
        for (let x = 0; x < image.width; x++) {
          const pixel = (8 * image.width + x) * 4;
          expect([...image.data.subarray(pixel, pixel + 4)]).toEqual(
            pageIndex * tile + Math.floor(x / 16) === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]
          );
        }
        pageIndex++;
        end += length;
      }
      directory += end;
      if (!separate) expect(directory).toBe(bytes.length);
    }
  }
  expect(pageIndex).toBe(pageCount);
});
