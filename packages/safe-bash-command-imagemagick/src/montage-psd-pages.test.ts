import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "montage", "retained", "buffered", "sync"] as const)
for (const tile of [1, 3])
for (const adjoin of [[], ["-adjoin"], ["+adjoin"]])
for (const output of ["/sheet.psd", "psd:-", "/sheet-%d.psd"])
it(`writes montage PSD pages to ${output} via ${mode}, tile=${tile}, ${adjoin}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const args = ["-size", "1x1", "xc:red", "xc:blue", "xc:lime", "-geometry", "+0+0", "-tile", `${tile}x1`, "-depth", "8", ...adjoin, output];
  const chunks: Uint8Array[] = [];
  if (mode === "command" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
    const context: CommandContext = {
      command: mode === "command" ? "magick" : "montage", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { expect(new TextDecoder().decode(bytes)).toBe(""); } }, registerCleanup() {}
    };
    expect((await (mode === "command" ? createMagickCommand() : createMontageCommand()).execute(context)).exitCode).toBe(0);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    if (result.stdoutBytes) chunks.push(result.stdoutBytes);
  }
  const retained = mode === "command" || mode === "montage" || mode === "retained";
  const names = retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
  const pageCount = Math.ceil(3 / tile);
  const separate = output.includes("%d") || adjoin.includes("+adjoin");
  const expectedNames = output === "psd:-" ? [] : separate && (pageCount > 1 || output.includes("%d"))
    ? Array.from({ length: pageCount }, (_, index) => `/sheet-${index}.psd`) : [output];
  expect(names.sort()).toEqual(expectedNames);
  const encoded = output === "psd:-" ? [Buffer.concat(chunks)]
    : await Promise.all(expectedNames.map(name => retained ? fs.readFile(name) : files.get(name)!));
  if (output !== "psd:-") expect(chunks).toHaveLength(0);
  let pageIndex = 0;
  for (const bytes of encoded) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let start = 0;
    while (start < bytes.length) {
      expect(Buffer.from(bytes.subarray(start, start + 6)).toString("hex")).toBe("384250530001");
      expect(view.getUint16(start + 22)).toBe(8);
      let offset = start + 30 + view.getUint32(start + 26);
      offset += 4 + view.getUint32(offset);
      const layers = view.getInt16(offset + 8);
      expect(layers).toBe(separate || pageCount === 1 ? 1 : pageCount - 1);
      offset += 4 + view.getUint32(offset);
      expect(view.getUint16(offset)).toBe(0);
      const end = offset + 2 + tile * 3;
      const document = bytes.subarray(start, end);
      for (let page = 0; page <= layers; page++) {
        const image = decodeImage(document, { page });
        expect([image.width, image.height]).toEqual([tile, 1]);
        const sourcePage = separate || pageCount === 1 ? pageIndex : page;
        for (let x = 0; x < tile; x++) {
          expect([...image.data.subarray(x * 4, x * 4 + 4)]).toEqual(
            [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]][sourcePage * tile + x]
          );
        }
      }
      pageIndex += separate ? 1 : pageCount;
      start = end;
      if (!separate) expect(start).toBe(bytes.length);
    }
  }
  expect(pageIndex).toBe(pageCount);
});
